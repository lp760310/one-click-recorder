(function () {
  const DB_NAME = "one-click-recorder-db";
  const DB_VERSION = 1;
  const STORE_NAME = "records";

  const recordButton = document.getElementById("recordButton");
  const statusText = document.getElementById("statusText");
  const supportMessage = document.getElementById("supportMessage");
  const recordsList = document.getElementById("recordsList");
  const emptyState = document.getElementById("emptyState");
  const recordCount = document.getElementById("recordCount");
  const exportButton = document.getElementById("exportButton");
  const importInput = document.getElementById("importInput");

  let db;
  let stream;
  let recorder;
  let chunks = [];
  let isRecording = false;

  function supportsRecording() {
    return Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function transaction(mode) {
    return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
  }

  function getAllRecords() {
    return new Promise((resolve, reject) => {
      const request = transaction("readonly").getAll();
      request.onsuccess = () => resolve(request.result.sort((a, b) => b.createdAt - a.createdAt));
      request.onerror = () => reject(request.error);
    });
  }

  function saveRecord(record) {
    return new Promise((resolve, reject) => {
      const request = transaction("readwrite").put(record);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  function deleteRecord(id) {
    return new Promise((resolve, reject) => {
      const request = transaction("readwrite").delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  function clearRecords() {
    return new Promise((resolve, reject) => {
      const request = transaction("readwrite").clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  function formatDate(timestamp) {
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).format(new Date(timestamp));
  }

  function setRecordingUi(recording) {
    isRecording = recording;
    statusText.textContent = recording ? "正在录音" : "未开始";
    statusText.classList.toggle("recording", recording);
    recordButton.textContent = recording ? "停止录音" : "一键开始录音";
    recordButton.classList.toggle("recording", recording);
  }

  function pickMimeType() {
    const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) {
      return "";
    }
    return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
  }

  async function startRecording() {
    if (!supportsRecording()) {
      supportMessage.hidden = false;
      return;
    }

    stream = stream || await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    const mimeType = pickMimeType();
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

    recorder.addEventListener("dataavailable", (event) => {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data);
      }
    });

    recorder.addEventListener("stop", async () => {
      const blobType = mimeType || chunks[0]?.type || "audio/webm";
      const audioBlob = new Blob(chunks, { type: blobType });
      chunks = [];

      if (audioBlob.size > 0) {
        await saveRecord({
          id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
          createdAt: Date.now(),
          note: "",
          type: audioBlob.type,
          audio: audioBlob
        });
        await renderRecords();
      }

      setRecordingUi(false);
    }, { once: true });

    recorder.start();
    setRecordingUi(true);
  }

  function stopRecording() {
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  async function dataUrlToBlob(dataUrl) {
    const response = await fetch(dataUrl);
    return response.blob();
  }

  async function exportJson() {
    const records = await getAllRecords();
    const payload = {
      exportedAt: new Date().toISOString(),
      app: "one-click-recorder",
      records: await Promise.all(records.map(async (record) => ({
        id: record.id,
        createdAt: record.createdAt,
        note: record.note || "",
        type: record.type || record.audio?.type || "audio/webm",
        audioDataUrl: await blobToDataUrl(record.audio)
      })))
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `one-click-recorder-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importJson(file) {
    const text = await file.text();
    const payload = JSON.parse(text);
    const incoming = Array.isArray(payload.records) ? payload.records : [];

    if (!incoming.length) {
      alert("没有找到可导入的记录。");
      return;
    }

    const confirmed = confirm("导入会替换当前浏览器中的全部录音记录，确定继续吗？");
    if (!confirmed) {
      return;
    }

    await clearRecords();
    for (const item of incoming) {
      if (!item.audioDataUrl) {
        continue;
      }
      const audio = await dataUrlToBlob(item.audioDataUrl);
      await saveRecord({
        id: item.id || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random())),
        createdAt: Number(item.createdAt) || Date.now(),
        note: item.note || "",
        type: item.type || audio.type || "audio/webm",
        audio
      });
    }

    await renderRecords();
  }

  async function renderRecords() {
    const records = await getAllRecords();
    recordsList.innerHTML = "";
    recordCount.textContent = `${records.length} 条`;
    emptyState.hidden = records.length > 0;

    for (const record of records) {
      const card = document.createElement("article");
      card.className = "record-card";

      const meta = document.createElement("div");
      meta.className = "record-meta";
      meta.textContent = formatDate(record.createdAt);

      const audio = document.createElement("audio");
      audio.controls = true;
      audio.src = URL.createObjectURL(record.audio);

      const note = document.createElement("textarea");
      note.placeholder = "添加文字备注";
      note.value = record.note || "";
      note.addEventListener("change", async () => {
        record.note = note.value;
        await saveRecord(record);
      });

      const remove = document.createElement("button");
      remove.className = "delete-button";
      remove.type = "button";
      remove.textContent = "删除";
      remove.addEventListener("click", async () => {
        if (confirm("确定删除这条录音记录吗？")) {
          URL.revokeObjectURL(audio.src);
          await deleteRecord(record.id);
          await renderRecords();
        }
      });

      card.append(meta, audio, note, remove);
      recordsList.appendChild(card);
    }
  }

  recordButton.addEventListener("click", () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording().catch((error) => {
        console.error(error);
        supportMessage.hidden = false;
        setRecordingUi(false);
      });
    }
  });

  exportButton.addEventListener("click", () => {
    exportJson().catch((error) => {
      console.error(error);
      alert("导出失败。");
    });
  });

  importInput.addEventListener("change", () => {
    const file = importInput.files && importInput.files[0];
    if (!file) {
      return;
    }
    importJson(file).catch((error) => {
      console.error(error);
      alert("导入失败，请确认 JSON 文件格式正确。");
    }).finally(() => {
      importInput.value = "";
    });
  });

  async function init() {
    db = await openDb();
    if (!supportsRecording()) {
      supportMessage.hidden = false;
    }
    await renderRecords();
  }

  init().catch((error) => {
    console.error(error);
    alert("初始化失败，请检查浏览器是否支持 IndexedDB。");
  });
})();

(function () {
  const recordButton = document.getElementById("recordButton");
  const exportButton = document.getElementById("exportButton");
  const clearButton = document.getElementById("clearButton");
  const statusText = document.getElementById("statusText");
  const durationText = document.getElementById("durationText");
  const segmentCount = document.getElementById("segmentCount");
  const supportMessage = document.getElementById("supportMessage");

  const m4aTypes = [
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4"
  ];

  let stream = null;
  let recorder = null;
  let chunks = [];
  let mimeType = "";
  let state = "idle";
  let elapsedMs = 0;
  let recordingStartedAt = 0;
  let segmentTotal = 0;
  let timerId = null;
  let shouldExportOnStop = false;

  function supportsRecording() {
    return Boolean(
      navigator.mediaDevices &&
      navigator.mediaDevices.getUserMedia &&
      window.MediaRecorder &&
      pickM4aMimeType()
    );
  }

  function pickM4aMimeType() {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) {
      return "";
    }
    return m4aTypes.find((type) => MediaRecorder.isTypeSupported(type)) || "";
  }

  function formatDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    return `${minutes}:${seconds}`;
  }

  function currentElapsedMs() {
    if (state !== "recording") {
      return elapsedMs;
    }
    return elapsedMs + Date.now() - recordingStartedAt;
  }

  function setTimerRunning(shouldRun) {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
    if (shouldRun) {
      timerId = window.setInterval(render, 250);
    }
  }

  function render() {
    durationText.textContent = formatDuration(currentElapsedMs());
    segmentCount.textContent = String(segmentTotal);
    statusText.classList.toggle("recording", state === "recording");
    recordButton.classList.toggle("recording", state === "recording");

    if (state === "recording") {
      statusText.textContent = "正在录音";
      recordButton.textContent = "停止录音";
      exportButton.disabled = true;
      clearButton.disabled = true;
      return;
    }

    if (state === "paused") {
      statusText.textContent = "已停止，可继续追加";
      recordButton.textContent = "继续录音";
      exportButton.disabled = false;
      clearButton.disabled = false;
      return;
    }

    statusText.textContent = "未开始";
    recordButton.textContent = "一键开始录音";
    exportButton.disabled = true;
    clearButton.disabled = true;
  }

  async function ensureStream() {
    if (stream && stream.active) {
      return stream;
    }
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    return stream;
  }

  function handleRecorderStop() {
    const blobType = mimeType || chunks[0]?.type || "";
    if (!blobType.includes("mp4")) {
      supportMessage.hidden = false;
      resetCurrentVoice();
      return;
    }

    const audioBlob = new Blob(chunks, { type: blobType });
    const shouldDownload = shouldExportOnStop && audioBlob.size > 0;

    if (shouldDownload) {
      downloadBlob(audioBlob, blobType);
    }

    resetCurrentVoice();
  }

  async function startNewVoice() {
    const audioStream = await ensureStream();
    mimeType = pickM4aMimeType();
    if (!mimeType) {
      supportMessage.hidden = false;
      throw new Error("M4A recording is not supported by this browser.");
    }

    chunks = [];
    recorder = new MediaRecorder(audioStream, { mimeType });

    recorder.addEventListener("dataavailable", (event) => {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data);
      }
    });

    recorder.addEventListener("stop", handleRecorderStop, { once: true });
    recorder.start();
  }

  async function startOrResumeRecording() {
    if (!supportsRecording()) {
      supportMessage.hidden = false;
      return;
    }

    if (state === "paused" && recorder && recorder.state === "paused") {
      recorder.resume();
    } else {
      await startNewVoice();
    }

    state = "recording";
    recordingStartedAt = Date.now();
    setTimerRunning(true);
    render();
  }

  function pauseRecording() {
    if (!recorder || recorder.state !== "recording") {
      return;
    }

    elapsedMs = currentElapsedMs();
    segmentTotal += 1;
    recorder.requestData();
    recorder.pause();
    state = "paused";
    setTimerRunning(false);
    render();
  }

  function resetCurrentVoice() {
    chunks = [];
    recorder = null;
    mimeType = "";
    state = "idle";
    elapsedMs = 0;
    recordingStartedAt = 0;
    segmentTotal = 0;
    shouldExportOnStop = false;
    setTimerRunning(false);
    render();
  }

  function timestamp() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  }

  function downloadBlob(audioBlob) {
    const url = URL.createObjectURL(audioBlob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `one-click-recording-${timestamp()}.m4a`;
    document.body.appendChild(link);
    link.click();
    link.remove();

    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportVoiceFile() {
    if (state !== "paused" || !recorder || recorder.state === "inactive") {
      return;
    }

    shouldExportOnStop = true;
    recorder.stop();
  }

  function clearCurrentVoice() {
    if (!recorder || recorder.state === "inactive") {
      resetCurrentVoice();
      return;
    }

    shouldExportOnStop = false;
    recorder.stop();
  }

  recordButton.addEventListener("click", () => {
    if (state === "recording") {
      pauseRecording();
      return;
    }

    startOrResumeRecording().catch((error) => {
      console.error(error);
      supportMessage.hidden = false;
      resetCurrentVoice();
    });
  });

  exportButton.addEventListener("click", exportVoiceFile);

  clearButton.addEventListener("click", () => {
    if (confirm("确定清空当前未导出的语音吗？清空后无法恢复。")) {
      clearCurrentVoice();
    }
  });

  if (!supportsRecording()) {
    supportMessage.hidden = false;
    recordButton.disabled = true;
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch((error) => {
        console.warn("Service worker registration failed", error);
      });
    });
  }

  render();
})();

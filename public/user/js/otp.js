function showToast(type = "default", message = "") {
  const containerId = "toast-container";
  let container = document.getElementById(containerId);
  if (!container) {
    container = document.createElement("div");
    container.id = containerId;
    container.style.cssText =
      "position:fixed;top:20px;right:20px;z-index:9999;";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.innerText = message;
  toast.style.cssText = `
    padding:12px 16px;margin-top:10px;border-radius:8px;
    color:#fff;font-size:14px;font-family:sans-serif;
    min-width:200px;box-shadow:0 4px 10px rgba(0,0,0,0.2);
    opacity:0;transform:translateX(100%);transition:all 0.3s ease;
  `;
  if (type === "success")       toast.style.background = "#28a745";
  else if (type === "error")    toast.style.background = "#dc3545";
  else if (type === "warning") { toast.style.background = "#ffc107"; toast.style.color = "#000"; }
  else                          toast.style.background = "#333";

  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = "1"; toast.style.transform = "translateX(0)"; }, 100);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(100%)";
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Must match the backend OTP expiry exactly (see authService.js: initiateSignupOTP,
// initiateForgotPassword, resendOTPToSession — all use 5 * 60 * 1000 ms).
const OTP_TTL_MS = 5 * 60 * 1000;

const inputs      = document.querySelectorAll(".otp-boxes input");
const verifyBtn   = document.getElementById("verifyBtn");
const resendBtn   = document.getElementById("resendBtn");
const timerEl     = document.getElementById("timer");
const errorEl     = document.getElementById("otpError");

let isExpired    = false;
let isSubmitting = false;
let countdown;

inputs.forEach((input, i) => {
  input.addEventListener("input", () => {
    input.value = input.value.replace(/[^0-9]/g, "");
    if (input.value && i < inputs.length - 1) inputs[i + 1].focus();
    autoSubmitIfComplete();
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Backspace" && !input.value && i > 0) inputs[i - 1].focus();
  });

  input.addEventListener("paste", (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/[^0-9]/g, "").slice(0, 6);
    if (!pasted) return;
    pasted.split("").forEach((char, idx) => { if (inputs[idx]) inputs[idx].value = char; });
    inputs[Math.min(pasted.length - 1, inputs.length - 1)].focus();
    autoSubmitIfComplete();
  });
});

function getOTP() {
  return [...inputs].map(i => i.value).join("");
}

function autoSubmitIfComplete() {
  if (isSubmitting) return;
  const otp = getOTP();
  if (otp.length === 6) {
    if (isExpired) return showError("OTP expired. Please resend.");
    submitOTP(otp);
  }
}

verifyBtn.addEventListener("click", () => {
  if (isSubmitting) return;
  const otp = getOTP();
  if (otp.length !== 6) return showError("Enter complete OTP");
  if (isExpired) return showError("OTP expired. Please resend.");
  submitOTP(otp);
});

async function submitOTP(otp) {
  if (isSubmitting) return;
  isSubmitting    = true;
  verifyBtn.disabled = true;
  clearError();

  try {
    const isReset = localStorage.getItem("resetFlow") === "true";
    const endpoint = isReset ? "/verify-reset-otp" : "/verify-otp";

    const res = await axios.post(endpoint, { otp });

    if (res.data.success) {
      localStorage.removeItem("otpExpiry");
      localStorage.removeItem("verifyEmail");
      localStorage.removeItem("resetFlow");
      localStorage.removeItem("signupFlow");

      showToast("success", res.data.message || "Verified!");

      setTimeout(() => {
        window.location.href = isReset ? "/reset-password" : "/login";
      }, 1000);

    } else {
      showError(res.data.message || "Invalid OTP");
      isSubmitting = false;
      verifyBtn.disabled = false;
    }
  } catch (err) {
    const msg = err.response?.data?.message || "Server error. Please try again.";
    showError(msg);
    isSubmitting = false;
    verifyBtn.disabled = false;
  }
}

// FIXED: was hardcoded to 59000ms (59 seconds). Now matches the real
// 5-minute backend OTP TTL.
function setExpiry() {
  localStorage.setItem("otpExpiry", Date.now() + OTP_TTL_MS);
}

// FIXED: was hardcoded to display "00:SS", which only looked correct because
// the old expiry never exceeded 59 seconds. Now properly formats mm:ss for
// any duration.
function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const mm = minutes < 10 ? "0" + minutes : minutes;
  const ss = seconds < 10 ? "0" + seconds : seconds;
  return `${mm}:${ss}`;
}

function startTimer() {
  clearInterval(countdown);
  countdown = setInterval(() => {
    const expiry    = parseInt(localStorage.getItem("otpExpiry"), 10);
    const remaining = Math.floor((expiry - Date.now()) / 1000);

    if (remaining <= 0) {
      clearInterval(countdown);
      timerEl.innerText    = "Expired";
      timerEl.style.color  = "red";
      isExpired = true;
      resendBtn.classList.remove("disabled");
      resendBtn.classList.add("active");
      return;
    }

    timerEl.innerText = formatTime(remaining);
  }, 1000);
}

resendBtn.addEventListener("click", async (e) => {
  e.preventDefault();
  if (!isExpired) return;

  try {
    const res = await axios.post("/resend-otp");
    if (res.data.success) {
      setExpiry();
      isExpired    = false;
      isSubmitting = false;

      inputs.forEach(i => (i.value = ""));
      inputs[0].focus();

      resendBtn.classList.remove("active");
      resendBtn.classList.add("disabled");
      timerEl.style.color = "";
      clearError();

      startTimer();
      showToast("success", "OTP resent successfully!");
    } else {
      showError(res.data.message || "Failed to resend OTP");
    }
  } catch (err) {
    showError(err.response?.data?.message || "Server error. Please try again.");
  }
});

function showError(msg) {
  errorEl.style.display = "block";
  errorEl.textContent   = msg;
}
function clearError() {
  errorEl.style.display = "none";
  errorEl.textContent   = "";
}

if (!localStorage.getItem("otpExpiry") || Date.now() > parseInt(localStorage.getItem("otpExpiry"), 10)) {
  setExpiry();
}

window.addEventListener("pageshow", (e) => { if (e.persisted) window.location.reload(); });

startTimer();
inputs[0].focus();
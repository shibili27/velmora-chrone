import { showToast } from "/utils/toast.js";

const inputs = document.querySelectorAll(".otp-boxes input");
const verifyBtn = document.getElementById("verifyBtn");
const resendBtn = document.getElementById("resendBtn");
const timerDisplay = document.getElementById("timer");
const error = document.getElementById("otpError");

let isExpired = false;
let countdown;
 
inputs.forEach((input, i) => {
  input.addEventListener("input", () => {
    input.value = input.value.replace(/[^0-9]/g, "");
    if (input.value && i < inputs.length - 1) {
      inputs[i + 1].focus();
    }
    autoSubmitIfComplete();
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Backspace" && !input.value && i > 0) {
      inputs[i - 1].focus();
    }
  });

  input.addEventListener("paste", (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/[^0-9]/g, "").slice(0, 6);
    if (!pasted) return;

    pasted.split("").forEach((char, idx) => {
      if (inputs[idx]) inputs[idx].value = char;
    });

    const lastIndex = Math.min(pasted.length - 1, inputs.length - 1);
    inputs[lastIndex].focus();

    autoSubmitIfComplete();
  });
});


function getOTP() {
  let otp = "";
  inputs.forEach(input => otp += input.value);
  return otp;
}


function autoSubmitIfComplete() {
  const otp = getOTP();
  if (otp.length === 6) {
    if (isExpired) return showError("OTP expired. Please resend.");
    submitOTP(otp);
  }
}


verifyBtn.addEventListener("click", () => {
  const otp = getOTP();
  if (otp.length !== 6) return showError("Enter complete OTP");
  if (isExpired) return showError("OTP expired. Please resend.");
  submitOTP(otp);
});


async function submitOTP(otp) {
  try {
    const email = localStorage.getItem("verifyEmail");
    const isReset = localStorage.getItem("resetFlow") === "true";
    const endpoint = isReset ? "/verify-reset-otp" : "/verify-otp";

    console.log("isReset:", isReset);
    console.log("endpoint:", endpoint);

    const res = await axios.post(endpoint, { otp, email });

    if (res.data.success) {
      localStorage.removeItem("otpExpiry");
      localStorage.removeItem("verifyEmail");
      localStorage.removeItem("resetFlow");   
      localStorage.removeItem("signupFlow");  
      showToast("success", res.data.message);

      if (isReset) {
        setTimeout(() => window.location.href = "/reset-password", 1000);
      } else {
        setTimeout(() => window.location.href = "/login", 1000);
      }
    } else {
      showError(res.data.message || "Invalid OTP");
    }

  } catch (err) {
    showError("Server error. Please try again.");
  }
}


function setExpiry() {
  localStorage.setItem("otpExpiry", Date.now() + 59000);
}

function startTimer() {
  clearInterval(countdown);

  countdown = setInterval(() => {
    let expiry = parseInt(localStorage.getItem("otpExpiry"));
    let remaining = Math.floor((expiry - Date.now()) / 1000);

    if (remaining <= 0) {
      clearInterval(countdown);
      timerDisplay.innerText = "Expired";
      timerDisplay.style.color = "red";
      isExpired = true;
      resendBtn.classList.remove("disabled");
      resendBtn.classList.add("active");
      return;
    }

    timerDisplay.innerText = "00:" + (remaining < 10 ? "0" + remaining : remaining);
  }, 1000);
}


resendBtn.addEventListener("click", async (e) => {
  e.preventDefault();
  if (!isExpired) return;

  try {
    const res = await axios.post("/resend-otp");

    if (res.data.success) {
      setExpiry();
      isExpired = false;

      inputs.forEach(input => input.value = "");
      inputs[0].focus();

      resendBtn.classList.remove("active");
      resendBtn.classList.add("disabled");
      timerDisplay.style.color = "";

      startTimer();
      showToast("success", "OTP resent successfully!");
    } else {
      showError(res.data.message || "Failed to resend OTP");
    }

  } catch (err) {
    showError("Server error. Please try again.");
  }
});


function showError(msg) {
  error.style.display = "block";
  error.textContent = msg;
}


const storedExpiry = localStorage.getItem("otpExpiry");
if (!storedExpiry || Date.now() > parseInt(storedExpiry)) {
  setExpiry();
}


if (localStorage.getItem("resetFlow") === "true" && localStorage.getItem("verifyEmail")) {
}


window.addEventListener("pageshow", function (event) {
  if (event.persisted) { window.location.reload(); }
});

startTimer();
inputs[0].focus();
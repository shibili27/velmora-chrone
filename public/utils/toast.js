export function showToast(type = "default", message = "") {
  const containerId = "toast-container";

  let container = document.getElementById(containerId);

  // Create container if not exists
  if (!container) {
    container = document.createElement("div");
    container.id = containerId;
    container.style.position = "fixed";
    container.style.top = "20px";
    container.style.right = "20px";
    container.style.zIndex = "9999";
    document.body.appendChild(container);
  }

  // Create toast
  const toast = document.createElement("div");
  toast.innerText = message;

  // Base styles
  toast.style.padding = "12px 16px";
  toast.style.marginTop = "10px";
  toast.style.borderRadius = "8px";
  toast.style.color = "#fff";
  toast.style.fontSize = "14px";
  toast.style.fontFamily = "sans-serif";
  toast.style.minWidth = "200px";
  toast.style.boxShadow = "0 4px 10px rgba(0,0,0,0.2)";
  toast.style.opacity = "0";
  toast.style.transform = "translateX(100%)";
  toast.style.transition = "all 0.3s ease";

  // Type styles
  if (type === "success") {
    toast.style.background = "#28a745";
  } else if (type === "error") {
    toast.style.background = "#dc3545";
  } else if (type === "warning") {
    toast.style.background = "#ffc107";
    toast.style.color = "#000";
  } else {
    toast.style.background = "#333";
  }

  container.appendChild(toast);

  // Animate in
  setTimeout(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateX(0)";
  }, 100);

  // Remove after 3s
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(100%)";

    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 3000);
}
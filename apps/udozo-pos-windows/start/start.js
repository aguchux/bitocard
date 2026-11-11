// Waits for the internet, then opens the till on pos.udozo.com. Offline it says so and tries again every 5 seconds.
const START = "https://pos.udozo.com/app";
const PROBE = "https://pos.udozo.com/robots.txt";
const status = document.getElementById("status");
const retry = document.getElementById("retry");
let timer;

async function open() {
  clearTimeout(timer);
  retry.hidden = true;
  status.textContent = "Opening your till…";
  try {
    await fetch(PROBE, { mode: "no-cors", cache: "no-store" });
    location.replace(START);
  } catch {
    status.textContent = "You are offline. Udozo POS opens as soon as this computer is back on the internet.";
    retry.hidden = false;
    timer = setTimeout(open, 5000);
  }
}

retry.addEventListener("click", open);
window.addEventListener("online", open);
open();

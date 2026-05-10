export function updateStatus(status, isError = false) {
  const statusPanel = document.getElementById("intiface-status-panel")
  if (statusPanel) {
    statusPanel.textContent = `Status: ${status}`
    if (isError) {
      statusPanel.classList.remove("connected")
      statusPanel.classList.add("disconnected")
    }
  }
}

export function updateButtonStates(isConnected) {
  const connectButton = document.getElementById("intiface-connect-action-button")
  if (connectButton) {
    if (isConnected) {
      connectButton.innerHTML = '<i class="fa-solid fa-power-off"></i> Disconnect'
      connectButton.classList.remove("connect-button")
      connectButton.classList.add("disconnect-button")
    } else {
      connectButton.innerHTML = '<i class="fa-solid fa-power-off"></i> Connect'
      connectButton.classList.remove("disconnect-button")
      connectButton.classList.add("connect-button")
    }
  }

  const rescanButton = document.getElementById("intiface-rescan-button")
  if (rescanButton) {
    rescanButton.style.display = isConnected ? "" : "none"
  }

  const statusPanel = document.getElementById("intiface-status-panel")
  if (statusPanel) {
    if (isConnected) {
      statusPanel.classList.remove("disconnected")
      statusPanel.classList.add("connected")
    } else {
      statusPanel.classList.remove("connected")
      statusPanel.classList.add("disconnected")
    }
  }
}

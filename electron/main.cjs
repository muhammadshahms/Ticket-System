const { app, BrowserWindow, shell } = require("electron");
const path = require("node:path");

let mainWindow;

async function createWindow() {
  process.env.NODE_ENV = "production";
  process.env.DATA_DIR = path.join(app.getPath("userData"), "data");
  const { startServer } = await import("../server/index.js");
  await startServer();

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: "#071c18",
    title: "Bano Qabil Ticket System",
    icon: path.join(__dirname, "..", "assets", "banoqabil-logo.png"),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  await mainWindow.loadURL("http://127.0.0.1:4173");
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(createWindow).catch((error) => {
  console.error("Bano Qabil Ticket System failed to start:", error);
  app.quit();
});
app.on("window-all-closed", () => app.quit());
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

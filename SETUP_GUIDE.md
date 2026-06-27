# 👁️ EyeFlow — Setup & Installation Guide

This guide contains the step-by-step instructions to get the **EyeFlow Chrome Extension** up and running on any computer.

---

## 💻 Option A: Setup for Developers (Laptop/Development Machine)

Use this method on your main machine where you write code and have Node.js installed.

### Step 1: Install Dependencies

Open a terminal in the root folder of this project and install the dependencies:

```bash
npm install
```

### Step 2: Build the Extension

Compile the source code files (`/src`) into the final loaded bundle (`/dist`):

```bash
npm run build
```

### Step 3: Run the Tests

Verify that all unit tests and Puppeteer browser smoke tests pass successfully:

```bash
npm test
```

### Step 4: Load into Chrome

1. Open Google Chrome.
2. Navigate to `chrome://extensions/`.
3. Enable **Developer mode** in the top-right corner.
4. Click **Load unpacked** in the top-left corner.
5. Select the `dist/` folder inside this project directory.

---

## 🖥️ Option B: Deploy to a Low-Spec Desktop (No Node.js/Code Tools Needed)

Use this method to install the extension on a shared or slow desktop without installing development software.

### Step 1: Package the Build on your Laptop

1. Run `npm run build` on your main laptop to compile the latest version into `/dist`.
2. Compress (ZIP) the `/dist` folder on your laptop (name it `eyeflow-dist.zip`).

### Step 2: Transfer to the Desktop

1. Transfer `eyeflow-dist.zip` to the desktop (using a USB drive, email, Google Drive, etc.).
2. Extract (unzip) it on the desktop. This will give you a clean `dist/` folder.

### Step 3: Load into Chrome on the Desktop

1. Open Google Chrome on the desktop.
2. Navigate to `chrome://extensions/`.
3. Enable **Developer mode** in the top-right corner.
4. Click **Load unpacked** in the top-left corner.
5. Select the `dist/` folder that you just extracted.

---

## ⚙️ Step 4: Configuration (For both Options)

Once the extension is loaded in Chrome, follow these final configuration steps:

### 1. Enable Incognito Tracking (Critical for Monitoring)

By default, Chrome disables extensions in Incognito mode. To ensure time is tracked across all tabs:

1. Open the EyeFlow popup by clicking the icon in the toolbar.
2. Next to the **❌ Incognito Tracking** warning, click the **Enable** button.
3. Chrome's settings page for EyeFlow will open. Scroll down and toggle **Allow in Incognito** to **ON**.

### 2. Configure Weekly Email Reports

1. Go to a webhook service like [Formspree](https://formspree.io/) or [Make.com](https://make.com).
2. Copy your unique Webhook URL.
3. Open the EyeFlow popup, click to expand **Advanced Controls**, and paste your URL into the **Weekly Email Report** input field.
4. Click **Save Settings** and then click **Send Test Report** to verify.
5. Bookmark or check your email inbox connected to Formspree/Make to view incoming weekly reports.

---

## 🔒 Optional: Sibling Bypass Lockdown Guide (Advanced)

If you are using EyeFlow to monitor a sibling's screen habits, they might try to bypass the extension by opening Guest Mode, creating a new Chrome profile, or using another browser (like Microsoft Edge).

Here is how you can optionally lock down Windows and Google Chrome to prevent these bypasses:

### 1. Disable Chrome Guest Mode & Profile Creation (Windows Registry)

By default, users can click their profile icon in Chrome and browse as a Guest or create a new profile (which won't have EyeFlow installed). You can disable this:

1. Press `Win + R`, type `regedit`, and press **Enter** to open the Registry Editor.
2. Navigate to: `HKEY_LOCAL_MACHINE\SOFTWARE\Policies`
3. Right-click the `Policies` folder, select **New > Key**, and name it `Google`.
4. Right-click the `Google` folder, select **New > Key**, and name it `Chrome`.
5. Inside the `Chrome` key, right-click in the right pane, select **New > DWORD (32-bit) Value**, and name it:
   - `BrowserGuestModeEnabled` — leave its value data as `0`.
   - `BrowserAddPersonEnabled` — leave its value data as `0`.
6. Restart Chrome. The "Guest Mode" and "Add Profile" buttons will now be completely disabled.

### 2. Lock Down Microsoft Edge or Other Browsers

If they switch to Microsoft Edge, Safari, or Firefox, EyeFlow won't run. You can block access to these browsers or disable their internet connection:

#### Method A: Disable/Block Execution via registry (Simple)

1. In the Registry Editor, go to: `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Policies`
2. Create a new key inside `Policies` named `Explorer`.
3. Inside `Explorer`, create a new **DWORD (32-bit) Value** named `DisallowRun` and set its value to `1`.
4. Create a new key inside `Explorer` named `DisallowRun`.
5. Inside `DisallowRun`, create a **New > String Value** named `1` and set its value to `msedge.exe`.
6. (Optional) Create more string values named `2`, `3` for other browsers (e.g., `firefox.exe`, `opera.exe`).
7. Windows will now prevent Microsoft Edge or other listed browsers from launching.

#### Method B: Windows Parental Controls (Built-in)

Alternatively, if your sibling has a standard non-admin account:

1. Go to Windows **Settings > Accounts > Family**.
2. Add your sibling's account and classify it as a **Member** (Standard Account).
3. Under parental controls online, set a time limit of `0 minutes` on Microsoft Edge and block installation of other browsers, making Google Chrome (with EyeFlow) the only usable internet gateway.

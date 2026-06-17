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

1. Go to a webhook service like [Formspree](https://formspree.io/) or [Webhook.site](https://webhook.site).
2. Copy your unique Webhook URL.
3. Open the EyeFlow popup, click to expand **Advanced Controls**, and paste your URL into the **Weekly Email Report** input field.
4. Click **Save Settings** and then click **Send Test Report** to verify.
5. Bookmark your Webhook.site URL on your phone or work device to view incoming reports remotely.

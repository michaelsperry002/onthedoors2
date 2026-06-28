# Sequifi Sync — pull your real sales into your app

We found Sequifi's direct connection, so this is now **super simple**.
No browser robot, no big downloads. One file does it.

---

## How to use it

### 1️⃣ Double-click **`SYNC-MY-SALES`**
A little window opens and asks for your **Sequifi email and password**.
Type them in (the password won't show as you type — that's normal) and
press Enter.

It logs into Sequifi, grabs all your sales, and makes a file called
**`accounts.json`** right here in this folder.

### 2️⃣ Load it into your app
- Open your app → go to the **Commission** side (spinner button)
- Tap **Settings** → **Import from Sequifi**
- Pick the **`accounts.json`** file
- 🎉 All your accounts appear!

Run it again any time you want fresh numbers.

---

## Notes
- Needs **Node** installed (nodejs.org) — you already did that.
- Your login is only used to talk to Sequifi, exactly like the website
  does. Nothing is stored unless you choose to save it in config.json.
- Stuck? Take a screenshot and send it to Claude.

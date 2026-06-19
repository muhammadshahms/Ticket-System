# Bano Qabil Ticket System

Made by Bano Qabil Incubation. An offline-first branded ticket and interview queue system designed for multiple registration desks and any number of interview panels. One computer hosts the system; panel laptops and Reception devices join over the same Wi-Fi/LAN and receive live updates.

## Fastest setup (Windows)

Double-click `release/Bano Qabil Ticket System Setup 1.5.0.exe`, complete the installer, and launch **Bano Qabil Ticket System** from the Start menu. If Windows SmartScreen appears, choose **More info → Run anyway**; the local event build is not code-signed.

Super Admin login is fixed in the app:

- Username: `admin`
- Password: `BanoQabil@2026`

On the first launch, the setup wizard asks you to create the first Reception account only. Panels, extra Reception desks, and courses are still not preloaded.

## What is included

- Candidate registration: name, unique Pakistani phone number, Bano Qabil ID, and Bano Qabil course
- Automatic assignment to the panel with the shortest active queue, with manual override
- Super Admin workspace to create, rename, activate, and deactivate panels
- Super Admin can create and manage multiple Reception accounts
- Separate configurable login and live queue for every panel
- Call, announce, start, complete, and skip candidate workflow
- Printable 80mm interview ticket
- Public full-screen queue display at `/?display=1`
- Local SQLite storage, audit log, and no internet dependency after installation
- Reception course field includes 29 Bano Qabil courses scraped from `https://banoqabil.pk/courses` / the public courses API, while still allowing custom course typing if needed

## Run for tomorrow's event

Install [Node.js 20+](https://nodejs.org/), then run:

```powershell
npm install
npm run build
npm start
```

Open `http://localhost:4173` on the host computer. The reception screen shows the LAN address in its top bar. On each panel laptop, connect to the same Wi-Fi and open that address.

For a desktop window instead of the browser:

```powershell
npm run desktop
```

## Accounts and panels

Super Admin credentials are hardcoded for event-day access: `admin` / `BanoQabil@2026`. Create the first Reception account in the first-run wizard, then use the Super Admin dashboard to create and name each panel, create more Reception desks, and choose their login credentials.

## Offline hotspot operation

The host laptop owns the only SQLite database. Turn on the laptop's Mobile Hotspot, connect panel laptops or phones to it, and open the LAN address shown in the app (for example `http://192.168.137.1:4173`). Internet is not required.

All connected devices read and update the host database in real time over the local hotspot. The host app must remain open and awake. If a phone disconnects, it cannot submit changes while disconnected; when it reconnects, it automatically loads the latest queue state.

## Recommended interview-floor setup

1. Use one Windows laptop as the host and registration desk.
2. Put all five laptops on one dedicated Wi-Fi router or mobile hotspot.
3. Disable sleep on the host and keep it connected to power.
4. Open each panel login on its assigned laptop.
5. Optionally open `http://HOST-IP:4173/?display=1` on a TV or projector.
6. Register and complete two test candidates before doors open.

Data is stored in `data/banoqabil-queue.db` when using `npm start`, or in the app's Electron user-data folder when using the desktop launcher. Copy the database file after the event for backup.

## Production roadmap

After the event, the next version should add password management, CSV/Excel export, candidate edit/reassignment, backup/restore UI, multiple event dates, interview scoring and remarks, analytics, and HTTPS/cloud deployment if remote access is required.

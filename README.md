# Daybook College

A React + FastAPI MCA department portal for HOD-managed AMCA (first-year) and NMCA (second-year) timetables, faculty schedules, automatic day-order rotation, campus contacts, and timetable message previews.

## Run locally

Requirements: Python 3.10+ and Node.js 20+.

1. Install Python dependencies: `python -m pip install -r requirements.txt`
2. Install frontend dependencies: `npm.cmd install` (Windows PowerShell) or `npm install`
3. In one terminal, start the API from the project directory:

   ```powershell
   python -m uvicorn backend.main:app --reload
   ```

4. In another terminal, start React:

   ```powershell
   npm.cmd run dev
   ```

5. Open <http://localhost:5173> and sign in with the local development HOD account:
   - Email: `admin@gmail.com`
   - Password: `admin123`

   Interactive API documentation is at <http://127.0.0.1:8000/docs>.

The API creates `backend/daybook.db` on first run, migrates the earlier local database, and seeds separate AMCA and NMCA versions of the six-hour timetable shown in the college's reference: OR, SI, SE, E-II, DL, E-I, IT, and CS/LIB, including the SE LAB, IT LAB, and DL LAB blocks spanning hours 3–6. It also seeds sample student and faculty records. Both year schedules start with the reference timetable; edit them independently to enter the actual course-specific schedules.

The day-order cycle starts with Day Order 1 on the date of the first API startup. HOD can change the cycle start date and its day order in Settings; each calendar day advances the order, wrapping from 6 back to 1. The dashboard refreshes the calculated order automatically.

## Message previews

The **SMS activity** page retains separate custom-message composers for AMCA students, NMCA students, and faculty. You can draft a message, review eligible opted-in contacts, and generate timetable previews for the selected cohort. Preview messages can be saved to SQL message history and are never delivered.

SMS delivery and the daily reminder scheduler are currently disabled because no SMS provider is configured. Custom-message sending is disabled in the interface and the API rejects send requests without contacting a provider. The reminder time can still be configured for future use.

## HOD credentials

The local default account is for development only. Set these environment variables before starting the API to configure the first HOD account:

```powershell
$env:DAYBOOK_HOD_EMAIL = "hod@your-college.edu"
$env:DAYBOOK_HOD_PASSWORD = "use-a-unique-password-of-at-least-12-characters"
$env:DAYBOOK_HOD_NAME = "Department HOD"
$env:DAYBOOK_SECRET_KEY = "use-a-long-random-secret"
```

The account is created only when the database has no HOD account. The HOD can update their display name and sign-in email, and change their password, in the authenticated Profile section. Profile updates return a refreshed bearer token when the sign-in email changes. Set `DAYBOOK_ENV=production` in production; the API refuses to start with development default credentials or signing key. All timetable, people, settings, profile, and message APIs require a valid HOD bearer token; only health check and login are public.

## Current scope

- Browse and edit separate AMCA/NMCA six-hour day-order grids, including multi-hour labs.
- View a distinct faculty timetable combining assignments from both years, and select faculty from the active People directory when editing classes.
- Calculate the current day order from a configurable cycle start date and starting order.
- Restrict the portal and API to the HOD login.
- Edit the HOD profile name and sign-in email, and securely change the password.
- Search, add, edit, and remove students and faculty; phone changes require fresh SMS verification, and removed faculty assignments become unassigned.
- Save college and reminder settings in SQLite.
- Generate student/faculty message previews and view message history; custom-message composers remain available while sending is disabled.

Message previews are non-delivering, and there is no SMS provider integration or background delivery worker configured. Sample contacts are fictitious; replace them with authorized college data and deploy only behind HTTPS before production use.

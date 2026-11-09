# Daybook

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

## Deploy

The Vercel deployment serves the React frontend and FastAPI backend from the same domain. The backend requires a persistent PostgreSQL database; do not rely on local SQLite for Vercel serverless deployments.

1. Import the repository into Vercel using the repository root. `vercel.json` configures `npm run build`, the `dist` output, client-side route fallback, and `/api/*` routing to the FastAPI function in `api/index.py`.
2. Create a persistent PostgreSQL database with Neon and add its connection URL as the Vercel environment variable `DATABASE_URL`.
3. Set these Vercel environment variables for Production:
   - `DAYBOOK_ENV`: `production`.
   - `DAYBOOK_HOD_EMAIL`, `DAYBOOK_HOD_PASSWORD`, and `DAYBOOK_SECRET_KEY`: secure production-only values. These initial HOD credentials are used only when the database is first initialized.
4. Configure Gmail SMTP with `GMAIL_ADDRESS` and `GMAIL_APP_PASSWORD` (a Gmail App Password; use a separate Secret environment variable for the password). Configure `CRON_SECRET` as a long random secret to authorize the scheduled reminder route.
5. Redeploy after adding or changing environment variables. The frontend calls `/api` on the same Vercel domain, so `VITE_API_BASE_URL` and cross-origin configuration are not required.

Vercel deployments refuse to start the API without `DATABASE_URL` in production rather than falling back to an ephemeral SQLite file. Keep the database URL, HOD password, and signing key out of source control.

## Email notices

The **Email activity** page supports custom messages to an AMCA/NMCA cohort or faculty, preview saving, and personalized daily timetable emails. The timetable section can immediately send the selected day-order template to a student cohort or send each scheduled teacher their individual classes. Gmail sending uses SMTP with a Google App Password. Configure `GMAIL_ADDRESS`, `GMAIL_APP_PASSWORD`, and `CRON_SECRET` in Vercel Production; never commit them to source control. The Vercel cron sends daily at 7:00 AM India Standard Time and sends at most 100 messages per run. Custom sends are also limited to 100 recipients per request.

Upload a CSV with the header `name,email,role,group_name`; `role` must be `Student` or `Teacher`, and students should use the `AMCA` or `NMCA` group. Imports can create contacts or update matching email addresses, and imported contacts are enabled for timetable emails. The People page provides a downloadable CSV template. Demo contacts are never emailed.

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
- Search, add, edit, remove, and bulk-import students and faculty with email contacts; removed faculty assignments become unassigned.
- Save college and reminder settings in SQLite.
- Send custom student/faculty emails, schedule personalized daily timetable emails, and view delivery history.

Message previews are non-delivering. Sample contacts are fictitious and cannot receive email. Use authorized college email addresses and deploy only behind HTTPS.

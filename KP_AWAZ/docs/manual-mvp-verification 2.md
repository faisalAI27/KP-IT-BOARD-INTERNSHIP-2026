# KP AWAZ Manual MVP Verification

Use this checklist with dedicated test accounts and non-sensitive sample audio. Never paste passwords, OTPs, access tokens, provider secrets, or the administrator key into this document.

## Prerequisites

- [ ] Start the FastAPI backend with its private `backend/.env` configuration.
- [ ] Start the frontend on an allowed local or deployed origin.
- [ ] Confirm `GET /api/health` reports a healthy backend.
- [ ] Confirm the Supabase email template sends a six-digit `{{ .Token }}` value.
- [ ] Keep the administrator key only in `backend/.env` and the live admin form.

## New email signup

- [ ] Open `auth.html` and choose Create Account.
- [ ] Enter a test display name, test email, password, and matching confirmation.
- [ ] Confirm the account request is accepted without exposing the password.
- [ ] Confirm the interface advances to email verification instead of the dashboard.

## Six-digit verification OTP

- [ ] Receive the six-digit code through the configured test mailbox.
- [ ] Paste or type the code and verify it.
- [ ] Confirm successful verification signs the user in automatically.
- [ ] Confirm the dashboard opens without requiring another password login.
- [ ] Confirm the OTP field is cleared after success or cancellation.

## Returning password login

- [ ] Sign out, return to `auth.html`, and choose Sign In.
- [ ] Enter the existing test email and password.
- [ ] Confirm no OTP or display-name field is requested.
- [ ] Confirm the existing profile and private dashboard data load.

## Google login

- [ ] Sign out and choose Continue with Google.
- [ ] Complete Google OAuth with an approved test account.
- [ ] Confirm KP AWAZ does not request a separate password or OTP.
- [ ] Confirm the dashboard loads the correct existing or newly initialized profile.

## Voice recording

- [ ] Open `contribute.html` while signed in.
- [ ] Load a provided sentence or enter an allowed custom sentence.
- [ ] Grant microphone access, start recording, and stop recording.
- [ ] Play the captured audio and confirm it is understandable.
- [ ] Re-record once and confirm the previous in-memory recording is replaced.

## Submission and pending status

- [ ] Submit one recording and confirm duplicate clicks do not create another request.
- [ ] Confirm the success message says the recording is waiting for administrator review.
- [ ] Open My Contributions and confirm the new item is Pending review.
- [ ] Confirm the score has not increased while the item is pending.

## Admin approval

- [ ] Open `admin.html` and enter the configured key without saving it elsewhere.
- [ ] Load the Pending queue and play the protected recording.
- [ ] Approve the contribution.
- [ ] Confirm it leaves Pending and the pending total decreases.
- [ ] Refresh the contributor history and confirm the item is Approved.

## Admin rejection

- [ ] Submit a second test recording and open it from the Pending queue.
- [ ] Confirm rejection is blocked until a reason is supplied.
- [ ] Reject it with a safe test reason.
- [ ] Confirm it leaves Pending and remains available in the contributor's history.
- [ ] Confirm the private rejection reason is visible only to the contributor.

## Score update

- [ ] Record the approved contribution count before review.
- [ ] Confirm approval increases the score by exactly one after refresh.
- [ ] Confirm rejection does not increase the score.
- [ ] If review correction is tested, confirm approved-to-rejected subtracts one and rejected-to-approved adds one.

## Leaderboard update

- [ ] Refresh the public leaderboard after approval.
- [ ] Confirm rank and approved-contribution count come from refreshed backend data.
- [ ] While signed in, locate the current-user row using the You marker.
- [ ] Confirm private email, user ID, profile ID, and ledger details are not displayed.

## Sign-out/sign-in persistence

- [ ] Note the test profile preferences, contribution statuses, score, and rank without recording private identifiers here.
- [ ] Sign out and confirm the public homepage opens.
- [ ] Sign in again using the same test account.
- [ ] Confirm the same profile preferences, contributions, review statuses, score, and rank return.
- [ ] Confirm no duplicate profile or contribution was created.
- [ ] Confirm previously stored audio still plays through the protected admin route.

## Verification record

- Date:
- Environment:
- Tester:
- Result: Pass / Fail
- Non-sensitive notes:

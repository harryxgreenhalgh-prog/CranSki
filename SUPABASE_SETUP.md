# Setting up Supabase for CranSki

CranSki's online features (accounts, cloud saves, friends and leaderboards) use the Supabase project at `https://owlralulybcvgaaahjbs.supabase.co`. The game itself stays static files on GitHub Pages; Supabase holds the accounts and data.

- The publishable key in `src/online/config.js` is meant to be public. On its own it can only do what the Row Level Security policies in `supabase/migrations/` allow.
- The secret (`service_role`) key never goes in the game's code or this repository. Only the Edge Functions use it, and Supabase supplies it to them on its own servers.

Your game's address is `https://harryxgreenhalgh-prog.github.io/CranSki/`. If you use a custom domain, use that instead wherever it appears below.

Do the sections in order. Each one says which build step needs it.

> **Shortcut for the database:** `supabase/setup.sql` contains all four SQL files below, joined together. Paste it once into **SQL Editor** → **New query** and click **Run**. It's safe to run on a project that already has some of it (for example only `profiles`), and safe to run again.

---

## 1. Profiles and gamertags (step 1)

### Run the SQL

1. Open the [Supabase dashboard](https://supabase.com/dashboard) and pick the CranSki project.
2. Left sidebar: **SQL Editor** → **New query**.
3. Open `supabase/migrations/20261108120000_profiles.sql` from this repository, copy all of it, and paste it into the editor.
4. Click **Run**. You should see "Success. No rows returned".
5. Check it worked: **Table Editor** should now list a `profiles` table, marked as RLS enabled.

The file is safe to run again if you need to.

### Turn on email sign-in links

1. **Authentication** → **Sign In / Providers** (called **Providers** in some versions) → **Email**:
   - **Enable Email provider**: on.
   - **Confirm email**: on.
   - Save.

   Supabase's email provider also supports passwords, but CranSki never shows a password form. Players only ever get a sign-in link.
2. **Authentication** → **URL Configuration**:
   - **Site URL**: `https://harryxgreenhalgh-prog.github.io/CranSki/`
   - **Redirect URLs**: click **Add URL** and add each of these:
     - `https://harryxgreenhalgh-prog.github.io/CranSki/**`
     - `http://localhost:5173/**` (for `npm run dev`)
     - `http://localhost:4173/**` (for `npm run preview`)
   - Save.

   The sign-in link only sends players back to addresses on this list.
3. **Put the sign-in code in the emails.** The game lets players type the code from the email instead of opening its link. That works on phones and tablets, works when an email app has turned the link off (Gmail does this for anything in spam), and keeps players in the same tab. Supabase uses two email templates for this, and both need the code:
   - **Authentication** → **Emails** → **Templates** → **Confirm signup**: sent the first time someone signs in.
   - **Authentication** → **Emails** → **Templates** → **Magic Link**: sent every time after that.

   For each one, set the **Subject** to `Your CranSki sign-in code` and replace the **Body** with this, then save:

   ```html
   <h2>Sign in to CranSki</h2>
   <p>Your sign-in code is:</p>
   <p style="font-size:30px;font-weight:bold;letter-spacing:6px">{{ .Token }}</p>
   <p>Type it into the game, or <a href="{{ .ConfirmationURL }}">open this link on the device you're playing on</a>.</p>
   <p>The code works once and expires after an hour. If you asked for more than one email, only the newest one works.</p>
   <p>If you didn't ask to sign in to CranSki, you can ignore this email.</p>
   ```

### Send email for real players

Supabase's built-in email sender is only meant for testing. It sends a few emails an hour at most, and newer projects may only deliver to members of your own Supabase team. Before you invite other players:

1. Get SMTP details from an email service (for example Resend, Postmark, Brevo or Amazon SES). You'll need to verify a domain you own with that service.
2. **Authentication** → **Emails** → **SMTP Settings** → turn on **Enable custom SMTP**, enter the host, port, username, password and a sender address, and save.
3. **Authentication** → **Rate Limits**: adjust the email limit if you need to.

**Using a Gmail account instead** (fine for a small game, about 500 emails a day). Best with a Gmail account made just for the game, because players see the sender address and name:

| Setting | Value |
| --- | --- |
| Sender email address | the same Gmail address as the username (Gmail won't send "from" any other address) |
| Sender name | `CranSki` |
| Host | `smtp.gmail.com` |
| Port number | `465` |
| Username | the Gmail address |
| Password | a Google **App Password**, not the normal password: turn on 2-Step Verification, then create one at myaccount.google.com/apppasswords and paste its 16 letters without spaces |

Emails sent this way can land in spam at first. Marking one **Not spam** helps for that inbox, and the code in the email works either way.

### Test it

1. Run `npm run dev` and open the address it prints.
2. Click **Sign in** (top right of Basecamp) and enter your email.
3. Type the code from the email into the game (or open the email's link). The game should sign you in and ask you to pick a gamertag.
4. In **Table Editor** → `profiles`, you should see your gamertag.

If the link opens a "requested path is invalid" or wrong-site page, the address isn't on the Redirect URLs list. If the game says the link has expired or was already used, you probably opened an older email: each new email cancels the one before it. Typing the code avoids all of this.

---

## 2. Cloud saves (step 2)

1. **SQL Editor** → **New query**.
2. Paste all of `supabase/migrations/20261108120100_saves.sql` and click **Run**.
3. **Table Editor** should now list a `saves` table, marked as RLS enabled.

That's all. When a signed-in rider changes a setting, sets a personal best or saves the Locker, the game merges it into their row in `saves` within a couple of seconds:

- **Settings and Locker:** the most recent change wins.
- **Personal bests:** the higher score for each park wins.

Graphics level, the 30 fps cap and the touch layout stay on each device.

Signed out, or offline, the game uses this browser's local saves exactly as before. Riders can only read their own row, and they can only change it through the merge function.

---

## 3. Friends (step 3)

1. **SQL Editor** → **New query**.
2. Paste all of `supabase/migrations/20261108120200_friends.sql` and click **Run**.
3. **Table Editor** should now list `friendships` and `presence`, both marked as RLS enabled.

How it works:

- Riders find each other by gamertag, ignoring case, spaces and dashes. Search needs a signed-in rider and typing at least 2 letters, and shows at most 10 results.
- A request shows only the sender's gamertag. If both riders ask each other, they become friends straight away.
- While the game is open, it records where you are (Basecamp, a lift, a run, a replay) about every 45 seconds. A rider counts as online if they were seen in the last 90 seconds.
- Online status and location are only ever returned for accepted friends, and nobody can read the `presence` table directly. Riders can tick **Appear offline** in the Friends panel to stop sharing it.
- Limits: 50 pending requests out, 200 friends.

---

## 4. Leaderboards and the submit-run Edge Function (step 4)

### Run the SQL

1. **SQL Editor** → **New query**.
2. Paste all of `supabase/migrations/20261108120300_leaderboards.sql` and click **Run**.
3. **Table Editor** should now list `leaderboard` and `leaderboard_runs`, both marked as RLS enabled.

### Deploy the function

The function lives in `supabase/functions/submit-run/`:

- `index.ts` connects it to your project.
- `handler.js` is the referee.
- `sim.js` is the game's simulation, bundled by `npm run build:sim`.

You deploy it from your computer with the Supabase CLI. You need Node.js, which you already use for `npm run dev`.

1. Open a terminal in the CranSki folder.
2. Log the CLI in to your Supabase account. It opens a browser window to confirm:

   ```bash
   npx supabase login
   ```

3. Connect this folder to your project. If it asks for the database password, you can press Enter to skip it; deploying functions doesn't need it.

   ```bash
   npx supabase link --project-ref owlralulybcvgaaahjbs
   ```

4. Deploy the function:

   ```bash
   npx supabase functions deploy submit-run --no-verify-jwt
   ```

   `--no-verify-jwt` matches `supabase/config.toml`. The function checks each rider's sign-in token itself. If the CLI complains that Docker isn't running, add `--use-api` to the end of the command so Supabase bundles it on their servers instead.
5. In the dashboard, **Edge Functions** should now list `submit-run`.

There are no secrets to set. Supabase gives every Edge Function its project URL and secret key automatically, on its servers. You can see them, but not their values, under **Edge Functions** → **Secrets**: `SUPABASE_URL`, plus `SUPABASE_SECRET_KEYS` or `SUPABASE_SERVICE_ROLE_KEY`. Never copy the secret key anywhere else.

### Test it

1. Sign in to the game and finish a run on BIG AIR.
2. The results screen should say **✓ Checked by the server · #1 on BIG AIR**.
3. **Basecamp** → **Leaderboard** shows the board.
4. In the dashboard, the `leaderboard` table has your row. **Edge Functions** → `submit-run` → **Logs** shows each check.

### When you change the physics later

The server must run exactly the same simulation as the game. After any change to `src/sim/`, `src/parks/` or `src/replay/record.js`:

1. If the change alters how runs play out, bump `SIM_VERSION` in `src/replay/record.js`.
2. Rebuild the bundled simulation, then commit the new `supabase/functions/submit-run/sim.js`:

   ```bash
   npm run build:sim
   ```

3. Deploy the function again:

   ```bash
   npx supabase functions deploy submit-run --no-verify-jwt
   ```

`npm test` fails if `sim.js` is out of date, so a stale referee can't slip through. Games still running the older version are told to reload before they can post.

### How the check works

- The game sends the run's recorded inputs (every 120 Hz step), the pause-menu resets, the grab buttons and ski/board choice, and the score the player saw.
- The function re-rides those inputs through the same deterministic simulation:
  - If the run doesn't reach the finish line, it's rejected.
  - If the score differs from the one the player saw, it's rejected.
  - Otherwise it saves the score **it** calculated, never the one sent.
- Riders can read the boards, but only the function can write to them. The inputs behind each board run are kept in `leaderboard_runs`, which isn't readable through the API.
- Each rider can submit at most 30 runs per 10 minutes.
- The simulation uses its own deterministic maths (`src/sim/dmath.js`), so Chrome, Firefox, Safari and the server all compute identical results.

---

## 5. Account deletion and the Privacy page (step 5)

Riders can delete their own account from **Account** → **Delete account**. That calls a second small Edge Function, which removes the Supabase Auth user. Every CranSki table is linked to the account with `on delete cascade`, so the profile, cloud save, friendships, online status, leaderboard scores and stored run inputs all go with it.

Deploy it the same way as `submit-run`:

```bash
npx supabase functions deploy delete-account --no-verify-jwt
```

To test it, sign in with a spare email address, then **Account** → **Delete account** → type `DELETE`. In the dashboard:

- **Authentication** → **Users** no longer lists that address.
- In **Table Editor**, its rows in `profiles`, `saves` and `leaderboard` are gone.

The in-game **Privacy** page (Basecamp footer → Privacy) lists what's stored on the device and on the server, and who can see each thing. If you change what the game stores, update `src/ui/pages.js` to match.

---

## Quick checklist

- [ ] SQL: paste `supabase/setup.sql` into the SQL Editor and run it. That's the four files in `supabase/migrations/` in one go. Alternatively, run `npx supabase db push` after `npx supabase link`; it asks for the database password.
- [ ] Email templates **Confirm signup** and **Magic Link** both include `{{ .Token }}` (section 1).
- [ ] Authentication → Email provider on, Confirm email on.
- [ ] Authentication → URL Configuration: Site URL and the three Redirect URLs.
- [ ] Custom SMTP set up before inviting players.
- [ ] `npx supabase functions deploy submit-run --no-verify-jwt`
- [ ] `npx supabase functions deploy delete-account --no-verify-jwt`
- [ ] Merge to `main` so GitHub Actions publishes the game.

Never needed, and never to be put in the game or this repo: the secret / `service_role` key.

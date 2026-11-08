# Setting up Supabase for CranSki

CranSki's online features (accounts, cloud saves, friends and leaderboards) use the Supabase project at `https://owlralulybcvgaaahjbs.supabase.co`. The game itself stays static files on GitHub Pages; Supabase holds the accounts and data.

- The publishable key in `src/online/config.js` is meant to be public. On its own it can only do what the Row Level Security policies in `supabase/migrations/` allow.
- The secret (`service_role`) key never goes in the game's code or this repository. Only the Edge Functions use it, and Supabase supplies it to them on its own servers.

Your game's address is `https://harryxgreenhalgh-prog.github.io/CranSki/`. If you use a custom domain, use that instead wherever it appears below.

Do the sections in order. Each one says which build step needs it.

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
3. Optional: **Authentication** → **Emails** → **Magic Link** lets you reword the email, for example the subject "Your CranSki sign-in link". Keep the `{{ .ConfirmationURL }}` link in it.

### Send email for real players

Supabase's built-in email sender is only meant for testing. It sends a few emails an hour at most, and newer projects may only deliver to members of your own Supabase team. Before you invite other players:

1. Get SMTP details from an email service (for example Resend, Postmark, Brevo or Amazon SES). You'll need to verify a domain you own with that service.
2. **Authentication** → **Emails** → **SMTP Settings** → turn on **Enable custom SMTP**, enter the host, port, username, password and a sender address, and save.
3. **Authentication** → **Rate Limits**: adjust the email limit if you need to.

### Test it

1. Run `npm run dev` and open the address it prints.
2. Click **Sign in** (top right of Basecamp) and enter your email.
3. Open the link in the email. It should open the game signed in, and ask you to pick a gamertag.
4. In **Table Editor** → `profiles`, you should see your gamertag.

If the link opens a "requested path is invalid" or wrong-site page, the address isn't on the Redirect URLs list.

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

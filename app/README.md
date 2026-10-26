# EDEN app (real version)

Food ordering, chat and voice calls for Redeemer's University. Installable web app on Supabase.

## Set up (about 10 minutes)
1. Create a free project at supabase.com.
2. In **SQL Editor**, run `sql/01_schema.sql`, then `sql/02_seed.sql`.
3. **Authentication → Providers → Email**: turn **off** "Confirm email" while testing.
4. Sign up in the app once, then make yourself admin (SQL Editor):
   `update profiles set role='admin', approved=true where id=(select id from auth.users where email='YOU@EMAIL');`
5. **Project Settings → API**: copy the Project URL and the **anon public** key into `config.js`. Never use the service_role key.
6. Push to GitHub. The app is at `https://<user>.github.io/Eden/app/`.

## Try without a database
Open `app/?mock=1`. Data lives in memory only.

## Before real launch
- Set `allow_demo_topup` to false in `app_config` and add Paystack (the wallet currently credits test money).
- Calls use STUN only. Add a TURN server in `config.js` if calls fail on some mobile networks. Calls only ring while the app is open.

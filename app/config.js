// EDEN app settings. Paste your Supabase project values here (both are safe to publish:
// access is protected by the database rules, not by hiding these keys).
window.EDEN_CONFIG = {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
  // Voice calls: STUN finds each phone's public address. Add a TURN server here later if
  // calls fail between some mobile networks (e.g. a free/paid TURN from Metered or Twilio).
  ICE_SERVERS: [{ urls: 'stun:stun.l.google.com:19302' }]
};

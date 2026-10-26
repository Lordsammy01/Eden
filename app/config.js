// EDEN app settings. Paste your Supabase project values here (both are safe to publish:
// access is protected by the database rules, not by hiding these keys).
window.EDEN_CONFIG = {
  SUPABASE_URL: 'https://fvyenmqoxwvrmmxlqxoj.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_dukvgHjbaSdiv4avoefKxw_MMvLEPVn',
  // Voice calls: STUN finds each phone's public address. Add a TURN server here later if
  // calls fail between some mobile networks (e.g. a free/paid TURN from Metered or Twilio).
  // Paste your Metered credentials URL here (looks like https://NAME.metered.live/api/v1/turn/credentials?apiKey=...)
  TURN_FETCH_URL: '',
  ICE_SERVERS: [
    { urls: 'stun:stun.l.google.com:19302' },
    // Free public relay for testing only. Replace with your own TURN account before launch.
    { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp', 'turns:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' }
  ]
};

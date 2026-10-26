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
    { urls: 'stun:stun.relay.metered.ca:80' },
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: [
        'turn:global.relay.metered.ca:80',
        'turn:global.relay.metered.ca:80?transport=tcp',
        'turn:global.relay.metered.ca:443',
        'turns:global.relay.metered.ca:443?transport=tcp'
      ], username: 'd76dac1717d21c4ba73a1355', credential: 'Qydop6X+tCFZpuT6' }
  ]
};

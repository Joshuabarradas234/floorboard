// Your store's server. Leave both empty to run the demo store instead.
// From Supabase: Project Settings -> API: the Project URL, and the publishable (or "anon public") key.
// The publishable key is meant to be public; the access rules in supabase/setup.sql protect the data.
window.FLOORBOARD_CONFIG = {
  supabaseUrl: 'https://dtddkocntgxlktwzcvyt.supabase.co',
  supabaseKey: 'sb_publishable_njrV4tkcsyurg8YjTcuvtA_-4B4znfX',
  // Lets phones and computers get alerts when Floorboard is closed (the matching private key lives only on the server).
  vapidPublicKey: 'BObiDNxNhrWIwRFL9i6_Ulr5_Mk3wGqsdI8N_wgpSIGR7YitjJmXenVLpklE24tKxb8ePkcg2-QJja_ry4j6-fY',
};

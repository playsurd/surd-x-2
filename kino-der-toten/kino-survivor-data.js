// Native Kino character assets, in stable lobby-slot order.
export const SURVIVORS = [
  { name: 'Dempsey', body: 'c_usa_dempsey_body' },
  { name: 'Nikolai', body: 'c_rus_nikolai_body' },
  { name: 'Takeo', body: 'c_jap_takeo_body' },
  { name: 'Richtofen', body: 'c_ger_richtofen_body', head: 'c_ger_richtofen_head', hat: 'c_ger_richtofen_offcap' },
];

export const SURVIVOR_ANIMATIONS = { down: 'pb_laststand_idle' };
for (const style of ['rifle', 'pistol']) {
  const suffix = style === 'pistol' ? '_pistol' : '';
  SURVIVOR_ANIMATIONS[style + ':idle'] = 'pb_stand_alert' + suffix;
  SURVIVOR_ANIMATIONS[style + ':ads'] = 'pb_stand_ads' + suffix;
  SURVIVOR_ANIMATIONS[style + ':crouch'] = 'pb_crouch_alert' + suffix;
  SURVIVOR_ANIMATIONS[style + ':sprint'] = 'pb_sprint' + suffix;
  SURVIVOR_ANIMATIONS[style + ':reload'] = style === 'pistol' ? 'pt_reload_stand_pistol' : 'pt_reload_stand_auto';
  for (const direction of ['forward', 'back', 'left', 'right']) {
    SURVIVOR_ANIMATIONS[style + ':' + direction] = style === 'pistol' ? 'pb_combatwalk_' + direction + '_loop_pistol' : 'pb_combatrun_' + direction + '_loop';
    SURVIVOR_ANIMATIONS[style + ':crouch-' + direction] = 'pb_crouch_run_' + direction + suffix;
  }
}

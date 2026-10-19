// The three cartridge + disc pairs.
export const GAMES = {
  1: { title: 'ROCKY ROAD TRIP', subtitle: 'puzzle platformer', gb: 'game1.gb', ps1: 'game1.exe', color: '#e85d8a',
    art: { cart: 'cart_rocky_road_trip', disc: 'disc_rocky_road_trip' } },
  2: { title: "VANILLA FIGHTER II.5 EX TURBO REMIX ~EXTRA SCOOP~ COLD EDITION '99 - DIRECTOR'S CUT (GREATEST HITS)", short: 'VANILLA FIGHTER II.5', subtitle: 'versus fighting', gb: 'game2.gb', ps1: 'game2.exe', color: '#4f7be8',
    // the team's label art (web/public/img/labels; from assets/images/labels)
    art: { cart: 'cart_vanilla_fighter', disc: 'disc_vanilla_fighter' } },
  3: { title: 'LICENSE TO CHILL', subtitle: 'zapper action', gb: 'game3.gb', ps1: 'game3.exe', color: '#3fbf7f',
    art: { cart: 'cart_license_to_chill', disc: 'disc_license_to_chill' } },
};
export const LAST_GAME = 3;
// The credits disc (GelatoStation only; it doesn't use the link).
export const CREDITS = 'credits';
GAMES[CREDITS] = { title: 'CREDITS', subtitle: 'Gelato Labs', ps1: 'credits.exe', color: '#f2b84b' };
// The cartridge you win by escaping reality (GB only).
export const WIN = 'win';
GAMES[WIN] = { title: 'YOU WIN!', subtitle: 'Gelato Labs', gb: 'ending.gb', color: '#9bbc0f' };

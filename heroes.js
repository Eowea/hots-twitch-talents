/* =========================================================================
   JETONS HÉROS — dictionnaire de recherche dans le battlelobby
   Le fichier est binaire : on ne sait pas encore à quel endroit exact le
   client range le héros de chaque joueur. En attendant, on cherche les noms
   sous toutes leurs formes connues.

   Heroes of the Storm désigne souvent un héros par son nom d'origine dans le
   jeu dont il vient ("Barbarian" pour Sonya, "DemonHunter" pour Valla...) :
   chaque héros porte donc plusieurs jetons, et le premier trouvé gagne.

   Les libellés ici sont les noms anglais canoniques. Les noms FR viendront de
   tes propres données héros (EOWEA BUILDS) au moment de l'affichage.
   ========================================================================= */
'use strict';

const HERO_TOKENS = [
  // [ jetons cherchés dans le fichier, nom du héros ]
  [['Abathur'], 'Abathur'],
  [['Alarak'], 'Alarak'],
  [['Alexstrasza'], 'Alexstrasza'],
  [['Anduin'], 'Anduin'],
  [['Ana'], 'Ana'],
  [['Anubarak', "Anub'arak"], "Anub'arak"],
  [['Artanis'], 'Artanis'],
  [['Arthas'], 'Arthas'],
  [['Auriel'], 'Auriel'],
  [['Azmodan'], 'Azmodan'],
  [['Firebat', 'Blaze'], 'Blaze'],
  [['FaerieDragon', 'Brightwing'], 'Brightwing'],
  [['Amazon', 'Cassia'], 'Cassia'],
  [['Chen'], 'Chen'],
  [['Cho'], 'Cho'],
  [['Chromie'], 'Chromie'],
  [['Deathwing'], 'Deathwing'],
  [['Deckard', 'DeckardCain'], 'Deckard'],
  [['Dehaka'], 'Dehaka'],
  [['Diablo'], 'Diablo'],
  [['DVa', 'D.Va'], 'D.Va'],
  [['L90ETC', 'ETC'], 'E.T.C.'],
  [['Falstad'], 'Falstad'],
  [['Fenix'], 'Fenix'],
  [['Gall'], 'Gall'],
  [['Garrosh'], 'Garrosh'],
  [['Tinker', 'Gazlowe'], 'Gazlowe'],
  [['Genji'], 'Genji'],
  [['Greymane'], 'Greymane'],
  [['Guldan', "Gul'dan"], "Gul'dan"],
  [['Hanzo'], 'Hanzo'],
  [['Hogger'], 'Hogger'],
  [['Illidan'], 'Illidan'],
  [['Imperius'], 'Imperius'],
  [['Jaina'], 'Jaina'],
  [['Crusader', 'Johanna'], 'Johanna'],
  [['Junkrat'], 'Junkrat'],
  [['Kaelthas', "Kael'thas"], "Kael'thas"],
  [['KelThuzad', 'Kelthuzad', "Kel'Thuzad"], "Kel'Thuzad"],
  [['Kerrigan'], 'Kerrigan'],
  [['Monk', 'Kharazim'], 'Kharazim'],
  [['Leoric'], 'Leoric'],
  [['LiLi', 'Li Li'], 'Li Li'],
  [['Wizard', 'LiMing', 'Li-Ming'], 'Li-Ming'],
  [['Medic', 'LtMorales', 'Morales'], 'Lt. Morales'],
  [['Lucio'], 'Lúcio'],
  [['Dryad', 'Lunara'], 'Lunara'],
  [['Maiev'], 'Maiev'],
  [['Malfurion'], 'Malfurion'],
  [['Malganis', "Mal'Ganis"], "Mal'Ganis"],
  [['Malthael'], 'Malthael'],
  [['Medivh'], 'Medivh'],
  [['Mei'], 'Mei'],
  [['Mephisto'], 'Mephisto'],
  [['Muradin'], 'Muradin'],
  [['Murky'], 'Murky'],
  [['Witchdoctor', 'Nazeebo'], 'Nazeebo'],
  [['Nova'], 'Nova'],
  [['Orphea'], 'Orphea'],
  [['Probius'], 'Probius'],
  [['Qhira'], 'Qhira'],
  [['Ragnaros'], 'Ragnaros'],
  [['Raynor'], 'Raynor'],
  [['Rehgar'], 'Rehgar'],
  [['Rexxar'], 'Rexxar'],
  [['Samuro'], 'Samuro'],
  [['SgtHammer', 'Sgt. Hammer'], 'Sgt. Hammer'],
  [['Barbarian', 'Sonya'], 'Sonya'],
  [['Stitches'], 'Stitches'],
  [['Stukov'], 'Stukov'],
  [['Sylvanas'], 'Sylvanas'],
  [['Tassadar'], 'Tassadar'],
  [['Butcher'], 'The Butcher'],
  [['LostVikings', 'LostViking'], 'The Lost Vikings'],
  [['Thrall'], 'Thrall'],
  [['Tracer'], 'Tracer'],
  [['Tychus'], 'Tychus'],
  [['Tyrael'], 'Tyrael'],
  [['Tyrande'], 'Tyrande'],
  [['Uther'], 'Uther'],
  [['Valeera'], 'Valeera'],
  [['DemonHunter', 'Valla'], 'Valla'],
  [['Varian'], 'Varian'],
  [['Whitemane'], 'Whitemane'],
  [['Necromancer', 'Xul'], 'Xul'],
  [['Yrel'], 'Yrel'],
  [['Zagara'], 'Zagara'],
  [['Zarya'], 'Zarya'],
  [['Zeratul'], 'Zeratul'],
  [['Zuljin', "Zul'jin"], "Zul'jin"],
];

/* Un jeton court ("Ana", "Cho", "Mei") tombe facilement au milieu d'un autre
   mot dans un fichier binaire. On les garde, mais signalés comme faibles. */
const WEAK_TOKEN_LENGTH = 4;

module.exports = { HERO_TOKENS, WEAK_TOKEN_LENGTH };

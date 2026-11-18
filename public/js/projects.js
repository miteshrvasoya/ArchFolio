/* Project data — edit this file to add, remove or update works.
   Projects with `images` are shown as featured works with a gallery;
   every project appears in the register. */

const img = (name, n) => Array.from({ length: n }, (_, i) => `assets/img/${name}-${i + 1}.jpg`);

export const PROJECTS = [
  {
    job: 'PLN-23-01',
    name: 'NIRANT the bunglow',
    category: 'Residential',
    year: '2023',
    location: 'Surat, Gujarat',
    area: '5,400 sq.ft.',
    status: 'Completed',
    images: img('nirant', 4),
    captions: [
      'Daylight approach — cantilevered exposed concrete volume over the entry staircase and arched lower colonnade',
      'Corner street view — monolithic concrete volumes, arched ground colonnade and landscaped stepped berm',
      'Dusk illumination — warm cove lighting across cantilevered slabs, double-height glazing and entry steps',
      'Night elevation — softly lit interior volumes, garage court and stepped entry'
    ],
    text: 'Nirant creates an enduring sanctuary of peace where raw architectural honesty meets refined modern comfort. Expansive glazing and private outdoor terraces invite natural daylight and garden views deep into an open-plan layout crafted for both family connection and quiet solace.'
  },
  {
    job: 'PLN-25-02',
    name: 'Weekend Retreat',
    category: 'Residential',
    year: '2025',
    location: 'Ahmedabad, Gujarat',
    area: '6,800 sq.ft.',
    status: 'Completed',
    images: img('retreat', 8),
    captions: [
      'Wraparound reflection pool and cantilevered timber-soffit terrace with cascading greenery',
      'Twilight elevation — illuminated pool court, sunken conversation pit and central courtyard tree',
      'Afternoon sun across red-brick arched bays and board-formed concrete parapets',
      'Upper terrace — twin arched brick windows framing the courtyard canopy',
      'Shadow study along the cantilevered balcony and double-height courtyard cutout',
      'Golden-hour silhouette against the western sky and the water edge',
      'Aerial composition — palm court, stepped lawn approach and wraparound water body',
      'Front elevation — exposed concrete, handcrafted brick and shaded glass verandahs'
    ],
    text: 'Weekend Retreat is designed for slow living, effortless hosting and rejuvenation. Private wraparound water features, a sunken conversation pit and breezy shaded balconies create a seamless sanctuary where architecture and nature continuously converse.'
  },
  {
    job: 'PLN-24-03', name: 'Kumaon Stone & Timber House', category: 'Residential', year: '2024',
    location: 'Almora, Uttarakhand', area: '3,200 sq.ft.', status: 'Built',
    text: 'Shaped along a contoured Himalayan ridge, this mountain residence pairs dry-stacked local slate walls with a south-facing solar trombe conservatory that captures winter warmth.'
  },
  {
    job: 'PLN-24-04', name: 'Tapi Courtyard Villa', category: 'Residential', year: '2024',
    location: 'Vesu, Surat', area: '4,950 sq.ft.', status: 'Built',
    text: 'A three-generation family house organized around a north-south breeze kund, allowing hot summer air to escape through high clerestory louvers while keeping ground rooms naturally cool.'
  },
  {
    job: 'PLN-25-05', name: 'Amaltas Verandah House', category: 'Residential', year: '2025',
    location: 'Bharuch, Gujarat', area: '4,100 sq.ft.', status: 'On Site',
    text: 'Deep 2.4-metre cantilevered concrete verandahs wrap around mature Amaltas trees, shielding the lime-plastered living spaces from monsoon downpours and harsh western glare.'
  },
  {
    job: 'PLN-23-06', name: 'Dumas Coastal Pavilion', category: 'Residential', year: '2023',
    location: 'Dumas, Surat', area: '3,800 sq.ft.', status: 'Built',
    text: 'Designed for saline coastal winds, this low-slung pavilion uses weathered corten louvers, kota stone floors and a sheltered inner garden court.'
  },
  {
    job: 'PLN-25-07', name: 'Sahaj Penthouse Atelier', category: 'Interior', year: '2025',
    location: 'Piplod, Surat', area: '3,400 sq.ft.', status: 'Completed',
    text: 'A calm, monolithic apartment interior crafted with seamless micro-concrete floors, reclaimed Valsadi teak joinery and a suspended brass-and-wood swing overlooking the terrace.'
  },
  {
    job: 'PLN-24-08', name: 'Katha Craft & Loom Studio', category: 'Interior', year: '2024',
    location: 'Ahmedabad, Gujarat', area: '2,150 sq.ft.', status: 'Completed',
    text: 'An exhibition and workspace for textile artisans featuring pivoting terracotta screens, raw kadappa stone display tables and glare-free north skylights.'
  },
  {
    job: 'PLN-23-09', name: 'Monolith Concrete Loft', category: 'Interior', year: '2023',
    location: 'Adajan, Surat', area: '2,600 sq.ft.', status: 'Completed',
    text: 'Stripping away false ceilings and synthetic partitions, this interior celebrates exposed coffered slabs, custom fluted timber cabinetry and warm indirect lighting.'
  },
  {
    job: 'PLN-25-10', name: 'Vayu Tea & Reading Sanctuary', category: 'Interior', year: '2025',
    location: 'Vadodara, Gujarat', area: '1,650 sq.ft.', status: 'Completed',
    text: 'A quiet acoustic interior lined with perforated mud-plaster walls, low floor-seating alcoves and a central stone water trough that hums gently through the afternoon.'
  },
  {
    job: 'PLN-24-11', name: 'Terracotta Jaali Kinetic Skin', category: 'Facade', year: '2024',
    location: 'Ring Road, Surat', area: '8,200 sq.ft.', status: 'Completed',
    text: 'A double-skin western facade composed of custom-extruded terracotta blocks rotated at 15-degree intervals to cut solar heat gain by 62% while preserving street views.'
  },
  {
    job: 'PLN-25-12', name: 'Surya-Bheda Brise-Soleil', category: 'Facade', year: '2025',
    location: 'Navrangpura, Ahmedabad', area: '6,400 sq.ft.', status: 'On Site',
    text: 'Inspired by Ahmedabad’s modernist concrete fins, this deep structural brise-soleil carves dramatic shadow patterns across the elevation from sunrise to dusk.'
  },
  {
    job: 'PLN-23-13', name: 'Weathered Corten & Brick Veil', category: 'Facade', year: '2023',
    location: 'Althan, Surat', area: '4,500 sq.ft.', status: 'Completed',
    text: 'An articulated residential street elevation where Flemish-bond red brickwork and laser-cut corten steel shutters filter dust, noise and afternoon glare.'
  },
  {
    job: 'PLN-26-14', name: 'Himalayan Artisans Makerspace', category: 'Other', year: '2026',
    location: 'Haldwani, Uttarakhand', area: '9,500 sq.ft.', status: 'In Design',
    text: 'A community craft and architectural makerspace featuring sawtooth north-light trusses, rammed-earth workshop bays and an open amphitheatre for design dialogues.'
  },
  {
    job: 'PLN-24-15', name: 'Sunken Stepwell Amphitheatre', category: 'Other', year: '2024',
    location: 'Bardoli, Gujarat', area: '12,000 sq.ft.', status: 'Completed',
    text: 'Reinterpreting Gujarat’s historic vav (stepwells), this subterranean stone landscape descends four levels to a seasonal rainwater recharging pool.'
  },
  {
    job: 'PLN-25-16', name: 'Bamboo & Rammed-Earth Pavilion', category: 'Other', year: '2025',
    location: 'Saputara, Gujarat', area: '2,900 sq.ft.', status: 'Completed',
    text: 'A zero-cement ecological pavilion built with treated Dangs bamboo diagrids and compacted local earth walls overlooking the Western Ghats escarpment.'
  }
];

export const CONTACT = {
  email: 'arvasoya2004@gmail.com',
  phone: '+919512991287'
};

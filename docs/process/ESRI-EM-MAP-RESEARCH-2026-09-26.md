# Esri Emergency Management Map Parity Research

Research date: 2026-09-26. Prepared for the Open Source EOC Map section (MapLibre GL JS, PMTiles, offline).

## How this was researched

Esri's narrative documentation (doc.arcgis.com) lists what each solution deploys but rarely states colors or layer lists. The authoritative source for the actual map content is the solution template itself. Every ArcGIS Solutions template is a public ArcGIS Online item owned by the `arcgis_solutions` account, and its `/data` JSON contains every web map (operational layers, renderers, popups, definition expressions, scale ranges) and every feature service definition (fields, coded domains, default drawing info). I pulled the current templates (most modified 2026-09-25) through the public ArcGIS REST API and decoded the renderers. Colors below are therefore exact hex values from Esri's shipped templates, not estimates. Where a value comes from narrative docs or a third party instead, the text says so.

Conventions used below: `#rrggbb/aNN` means alpha NN out of 255 (a128 is 50 percent). Point sizes are in points (Esri pt; 1 pt = 1.333 px). "CIM circle" means an Esri CIM vector marker: a white pictogram on a solid colored circle with a 0.42 to 0.5 pt black outline at 25 percent opacity.

---

## 1. The EM Solutions suite

The live ArcGIS Solutions catalog (owner `arcgis_solutions`) currently carries the following emergency-management templates. Several names the product owner listed (Situational Awareness, Crisis Response, Incident Action Planning, Emergency Response Coordination, Mass Care, Critical Facilities, Community Lifelines) are not separate current Esri solutions; the mapping from those names to what Esri actually ships is given at the end of this section.

**Emergency Management Operations (EMO)** (item 45de5780c57f4672830a2dd9abe4ffb3). The core EOC solution: "maintain situational awareness and share essential emergency information during an emergency." It deploys the Emergency Information Manager (Experience Builder, operations staff), the Incident Status Dashboard (command staff), the Community Lifelines Editor and Public Message Editor (Survey123), the Emergency Management Information Hub site, a Public Information Instant App (Basic template with legend, search, locate and basemap toggle), a Public Emergency Messaging Dashboard and a Past Public Message Notifications dashboard. Web maps: Emergency Information Manager, Incident Status Dashboard, Public Information. Feature services: Incidents (points, lines, areas), ImpactedArea, NoticesAndEvacuations (plus _public, _dashboard and _KnowYourZone views), EvacuationRoutes (routes plus pre-established zones), Resources (Shelters, Distribution Sites), RoadClosures (Blocks, Closures, Detours), CriticalInfrastructure, IncidentFacilities, and the EmergencyInformation tables (Public Message, Lifeline Status). Two yes/no fields drive every public filter: `activeincid` (Active Incident) and `publicview` (Publicly Visible). RoadClosures_public can be registered with Esri Community Maps, Waze and Google. The Experience Builder app includes a Business Analyst infographic (needs GeoEnrichment credits) and a Near Me widget. Sources: [intro](https://doc.arcgis.com/en/arcgis-solutions/latest/reference/introduction-to-emergency-management-operations.htm), [use](https://doc.arcgis.com/en/arcgis-solutions/latest/reference/use-emergency-management-operations.htm), [configure](https://doc.arcgis.com/en/arcgis-solutions/latest/reference/configure-emergency-management-operations.htm), [FAQ](https://doc.arcgis.com/en/arcgis-solutions/11.5/reference/emergency-management-operations-faq.htm), [template](https://www.arcgis.com/home/item.html?id=45de5780c57f4672830a2dd9abe4ffb3), [Esri industry page](https://www.esri.com/en-us/c/industry/public-safety/emergency-management-operations-solution).

**Damage Assessment** (item 989dd829ba6f44d59c2a66b4f838c169). Supports FEMA Individual Assistance (IA, private residences and businesses) and Public Assistance (PA, public facilities). Deploys a Damage Assessment Hub site, Damage Assessment Operations (Experience Builder), Damage Assessment Photo Viewer (Attachment Viewer Instant App), four Survey123 forms (Public Damage Report, Individual Assistance Survey, Public Assistance Survey, Public Assistance Damage Inventory), a Windshield Damage Report QuickCapture project, IA and PA dashboards, and an archive notebook. Web maps: Damage Assessment Manager, Photo Viewer, IA Dashboard, IA Survey, PA Damage Inventory, PA Dashboard, PA Survey, Public Damage Report. The Manager map adds the U.S. National Grid (100 m, 1 km, 10 km) and PA assessment areas and traces. Fields include incident type, damage level, dwelling type, owner or renter, insurance, flood insurance, primary residence, immediate needs, `tribeconfirm` and `tribe` (tribal jurisdiction), and a parcel ID populated from a local parcel layer. Sources: [intro](https://doc.arcgis.com/en/arcgis-solutions/latest/reference/introduction-to-damage-assessment.htm), [use](https://doc.arcgis.com/en/arcgis-solutions/latest/reference/use-damage-assessment.htm), [configure](https://doc.arcgis.com/en/arcgis-solutions/latest/reference/configure-damage-assessment.htm), [template](https://www.arcgis.com/home/item.html?id=989dd829ba6f44d59c2a66b4f838c169). Damage categories follow the [FEMA PDA Guide 2021](https://www.fema.gov/sites/default/files/documents/fema_2021-pda-guide.pdf) (revised [07/2025](https://www.fema.gov/sites/default/files/documents/fema_rd_pda-guide_07012025.pdf)).

**Emergency Shelter Management** (item 9ab7c15708d5404dace6b04127cd4d53). Mass care: shelter inventory, occupancy counts, guest registration. Deploys Shelter Management Center and Registration Management (Experience Builder), Shelter Staff Resources Hub, Shelter Status Dashboard, Resource Planning Dashboard, Shelter Reports Dashboard, and three Survey123 forms (Occupancy Count, Large Animal Occupancy Count, Guest Registration). Layers: EmergencyShelters (with Occupancy Count table), LargeAnimalShelters, GuestRegistrations, OccupancyCount_mostrecent (join view), public WarmingCenters and CoolingCenters views. Shelter attributes: Red Cross model (Managed, Partnered, Supported, Independent), status (Open, Closed, Alert, Standby, Unknown), accessible, backup power, charging station, food, water, internet, pets, cooling or warming center, capacity, pet capacity, adults, children, seniors, occupancy. Sources: [intro](https://doc.arcgis.com/en/arcgis-solutions/latest/reference/introduction-to-emergency-shelter-management.htm), [template](https://www.arcgis.com/home/item.html?id=9ab7c15708d5404dace6b04127cd4d53).

**Shelter Locator** (item 28cd55ddf9ec493fa9410569dd11dab4, now in the `MatureSupportSolutions` account as version 1.0, i.e. retired). A public app showing open shelters on a Navigation basemap with status icons. Superseded by Emergency Shelter Management. Source: [intro](https://doc.arcgis.com/en/arcgis-solutions/latest/reference/introduction-to-shelter-locator.htm).

**Know Your Zone** (item 3ea4387dce19409b8286b1e515e14530). Public evacuation-zone lookup. One web map with two copies of the same zone layer: one symbolized by pre-established zone letter (A to F) and one by current evacuation status, both labeled. Source: [intro](https://doc.arcgis.com/en/arcgis-solutions/latest/reference/introduction-to-know-your-zone.htm).

**Road Closures** (item 20e7798b488d4139b79d4238d3e35075). Public works and public safety closure inventory with an Experience Builder app, one web map (Light Gray Canvas plus an Esri roads reference layer, then Detours, Closures, Blocks), and a schema 1.0 to 2.0 data pipeline; closures can be contributed to consumer maps through Esri Community Maps. Source: [intro](https://doc.arcgis.com/en/arcgis-solutions/latest/reference/introduction-to-road-closures.htm).

**Emergency Debris Management** (item 545ac081cbd54de291d3d193f76e5b91). Road clearance in the first 72 hours, debris assessment, removal monitoring. Deploys Emergency Debris Management Center and Debris Records Reviewer (Experience Builder), Road Debris Reporter (QuickCapture), Debris Clearance Assignments (Workforce), Debris Removal Services (public Instant App), forms (Debris Assessment, Load Ticket, Unload Ticket, Truck Certification), and Debris Assessments, Clearance and Removal dashboards. Layers: Debris Areas, Debris Routes, Debris Assessments (by debris type), Debris Management Sites, Monitoring Tickets, Removal Providers, and a USNG grid group. Source: [intro](https://doc.arcgis.com/en/arcgis-solutions/latest/reference/introduction-to-emergency-debris-management.htm).

**Hazard Mitigation Planning (HMP)** (item d34c6650e3da4672ae4f0f18d93323cf). Geospatial risk assessment for FEMA hazard mitigation plans. Deploys the Hazard Risk Assessment Maps (Experience Builder), a Hazard Explorer and Risk Assessment Hazards, Profile, Vulnerability (Portfolio Instant Apps), Risk Assessment Export (Atlas Instant App), Mitigation Project Inventory (Sidebar) and Viewer (Basic), a plan-feedback form and manager, and a Hazard Mitigation Outreach Hub. It ships about 17 thematic web maps (one per hazard plus location, population, social vulnerability, resilience, climate, transportation, critical infrastructure and vulnerable assets), each built on an Area of Interest layer plus FEMA National Risk Index, CDC SVI, FEMA CRCI and hazard-specific Living Atlas layers. Local layers: HistoricalHazardEvents (points, lines, areas; 19 event types; federal, state and local declaration flags), HazardMitigationProjects (project type, HMA funding source, community lifeline, application status), CriticalInfrastructure. Sources: [intro](https://doc.arcgis.com/en/arcgis-solutions/latest/reference/introduction-to-hazard-mitigation-planning.htm), [use](https://doc.arcgis.com/en/arcgis-solutions/latest/reference/use-hazard-mitigation-planning.htm), [configure](https://doc.arcgis.com/en/arcgis-solutions/latest/reference/configure-hazard-mitigation-planning.htm).

**Wildfire Protection Planning** (item 79196d118958485596ee1f78e475dd05). An ArcGIS Pro project (needs Image Analyst) plus a Wildfire Mitigation Planner Experience Builder app. Map groups: Wildfire Risk and WUI (Global WUI), Historical Wildfires (MTBS burn and prescribed burn perimeters by year), Topography and Vegetation (USFS Wildfire Risk to Communities risk-reduction zones), Land Use and Ownership (Sentinel-2 land cover), Population (WRC population density), Location and Community Authority, Wildfire Mitigation Activities. Source: [intro](https://doc.arcgis.com/en/arcgis-solutions/latest/reference/introduction-to-wildfire-protection-planning.htm).

**Flood Impact Analysis** (item c570dee0a9fc4c7d8fea60342fc056f4). An ArcGIS Pro project package that intersects flood depth with critical infrastructure and shares flood impact maps. No web maps in the template. Source: [intro](https://doc.arcgis.com/en/arcgis-solutions/latest/reference/introduction-to-flood-impact-analysis.htm).

**Watch Center** (item 191c0464030f482c9b9369786d9048ce). The closest Esri product to "situational awareness / crisis response" monitoring. Requires ArcGIS Velocity. Watch officers define watch areas around locations; real-time analytics raise alerts when Living Atlas or partner feeds intersect them. Deploys the Watch Center Experience Builder app (widgets: map layers, legend, basemap gallery, bookmark, directions, print, draw, coordinates, add data, feature report), Watch Reports, Watch Alerts Monitor and Watch Alert Statistics dashboards. Feeds: USA Weather Watches and Warnings, USA Wildfires, World Earthquakes, World Hurricanes, plus paid partner feeds (Dataminr First Alert and Pulse, Factal, Samdesk, Seerist, DataCapable, Gridmetrics power outages). Basemap: Dark Gray Canvas. Source: [intro](https://doc.arcgis.com/en/arcgis-solutions/latest/reference/introduction-to-watch-center.htm).

**Incident Awareness and Assessment (IAA)** (item 3e417820296b4ff7be42fa4f6e8d2177) and **Civil Support** (item 8caa4ebb680648c39e4c7d2dbcf5867f). Military domestic operations (DSCA) versions of EMO. IAA is important for parity because its Military Features Map carries the most complete Esri-authored reference layer set: a "Foundational Infrastructure Data" group organized by the eight FEMA Community Lifelines, plus a "Natural Hazards Live Feeds" group. It also has a Lifeline Reporter form, Road Information (area road disruptions, detours, closures, blocks), Civilian Infrastructure, Military Facilities and Named Areas of Interest. Basemap: OpenStreetMap.

**Community Risk Reduction** (item 9e2c6967a0404fc69ef7380e4ec3961f), **Pre-Incident Planning** (a9d778129d324d869e0280593222031b), **Target Hazard Analysis**, **Special Event Operations** (ba68351201b2474db3db533414be712b), **Rapid Needs Assessment** (4f24cd9b79ed435c8747b56c81d30cc7), **Community Health Assessment**, **Outage Damage Assessment** (utility-sector damage assessment). These are fire-service, public-health or utility solutions tagged into the Emergency Management category. CRR contributes the "risk and vulnerability" reference stack (SVI 2022, CRCI, NRI tracts, USA Structures, critical infrastructure, fire districts and stations, NFIRS incident heat maps). Special Event Operations contributes event areas, lines and assets (grandstands, first aid, barricades, gates) and a road-closure group.

Retired templates (account `MatureSupportSolutions`) relevant to EM: Shelter Locator, Know Your Zone (older versions), Warming and Cooling Centers, Public Notification, the Coronavirus family. There is no current or retired Esri solution named Critical Facilities, Community Lifelines, Incident Action Planning, Mass Care, or Crisis Response in the catalog as of this date.

Mapping of the product owner's names to Esri reality:

| Requested name | What Esri ships |
|---|---|
| Emergency Management Operations | EMO (above) |
| Damage Assessment | Damage Assessment; Outage Damage Assessment (utilities) |
| Situational Awareness / Crisis Response | EMO Incident Status Dashboard; Watch Center; IAA; Living Atlas live feeds; Esri Disaster Response Program ([page](https://www.esri.com/en-us/disaster-response/overview)) |
| Incident Action Planning | No Esri solution. EMO covers incident facilities (ICP, staging, base, camp). IAP forms live in WebEOC (section 7). |
| Hazard Mitigation | Hazard Mitigation Planning; Wildfire Protection Planning; Flood Impact Analysis |
| Emergency Response Coordination | EMO; IAA and Civil Support for DSCA |
| Mass Care / Shelter Operations | Emergency Shelter Management; Shelter Locator (retired); Rapid Needs Assessment; Community Health Assessment |
| Public Information / Road Closures | EMO Public Information app and Hub; Know Your Zone; Road Closures |
| Critical Facilities | CriticalInfrastructure layer (16 CISA sectors) inside EMO, HMP, CRR; IAA lifeline-grouped reference layers |
| Community Lifelines | EMO Lifeline Status table plus Community Lifelines Editor plus eight dashboard lifeline cards; IAA Lifeline Reporter; HMP project lifeline field |
| Wildfire | Wildfire Protection Planning; CRR; live USA Wildfires feed |
| Tribal lands | No tribal solution. Damage Assessment has tribe fields. Living Atlas carries Census AIANNH layers; BIA publishes its own LAR service. |

---

## 2. Map layer catalog

Legend for the Source/License column: **PD** = U.S. federal public domain at the original source. **Esri-CC** = Esri's repackaged copy is CC BY 4.0 (bundle from the federal original instead, or keep attribution). **Esri-MLA** = Esri Master License Agreement (cannot be bundled or redistributed offline). **Local** = the agency's own data created in the solution.

### 2a. Operational layers shipped in the solution templates

| Layer | Geom | What it depicts | Symbology (exact, from template) | Solutions | Source / License |
|---|---|---|---|---|---|
| Incident Points | point | Incident origin, 23 types | CIM circle 15.75 pt, white glyph per type. Color by family: Fire, Public Health `#c93100`; Wildfire, Earthquake, Tsunami, Volcano `#6c4000`; Flooding, Hurricane, Tornado `#83c96e`; Severe Thunderstorm, Winter Storm, Marine, Agricultural Animal Health `#71d56e`; Chemical, Cyber, Radiological, Infestation, Other `#e89d00`; Civil Disturbance, Criminal Activity `#007ac2`; Air, Rail, Vehicle `#58595b`. Service default is a 4 pt black dot. | EMO, IAA | Local |
| Incident Lines | line | Linear incidents (spill path, pipeline) | Black `#000000` 1.75 pt solid | EMO, IAA | Local |
| Incident Areas | polygon | Direct incident footprint | Black fill at 25 percent (`#000000/a64`), black 1 pt outline | EMO, IAA | Local |
| Impacted Area | polygon | Wider area of possible effect, drives the demographic infographic | Hollow, `#c73500` 3 pt outline | EMO | Local |
| Notices and Evacuations | polygon | Protective action areas by `evactype` | Fill at 50 percent plus 1.5 pt outline in the same hue: Level 3 Mandatory Evacuation Order `#7a0000`; Level 2 Evacuation Warning `#e05434`; Level 1 Advisory Notice `#fda328`; Voluntary Evacuation fill `#f2e355`, outline `#e6d117`; Evacuation Order Lifted `#8cd1c8`; Shelter in Place `#ed66a6`; No Evacuation Order near-transparent white (`a13`) with grey `#858585` 0.5 pt outline. Public map sets layer opacity 0.7. | EMO, Know Your Zone | Local |
| Pre-established Evacuation Zones | polygon | Standing zones A to F (coastal) | Solid fills, no outline, 30 percent transparency: A `#e84154`, B `#f78539`, C `#f2e52c`, D `#c3d936`, E `#77bf80`, F `#6cacad` (dashboard map uses `#009aa3` for F). Labeled with zone name. Wildfire-style zones: transparent fill, black outline when no emergency. | EMO, Know Your Zone | Local |
| Evacuation Routes | line | Pre-established routes; road class, contraflow | Blue `#0465c1` 2 pt over pale yellow `#ffffe2` 4 pt casing | EMO | Local; nationally, Hurricane Evacuation Routes (below) |
| Road Closures | line | Closed segments; direction, reason, lane impact, access allowed | Red `#bf1f00` 1.7 to 2.25 pt line with vector arrow markers for One Direction or Both Directions | EMO, Road Closures, IAA, Special Events | Local |
| Road Blocks | point | Barricade points | Red `#c93100` circle with white horizontal bar (no-entry) 13.5 pt | EMO, Road Closures, IAA | Local |
| Detours | line | Alternate routes | Orange `#e69800` over white casing about 4.7 pt (service default orange 3 pt dashed) | EMO, Road Closures | Local |
| Area Road Disruptions | polygon | Wide-area road impact | Backward-diagonal hatch fill (one of only two hatch uses found in all templates) | IAA | Local |
| Shelters (EMO) | point | Shelter status | CIM circle 15.75 pt with house and bed glyph: Open `#009656`, Closed `#dc4536`, Standby `#a56daf`, Alert `#fbbc41`, Unknown `#8d99ae`. Popup: name, address, agency, Red Cross model, POC, status, large animal, warming, cooling, capacity, beds, occupancy, accessible, backup power, pets. | EMO | Local |
| Emergency Shelters (ESM) | point | Shelter status and occupancy | CIM circle 18 pt: Open `#5a9359`, Closed `#6e6e6e`, Standby `#e89d00`, Alert `#ad9300`, Unknown `#0079c1`. Reporting-freshness variant: white fill with thick 2.6 pt ring, green `#5a9359` within 12 h, red `#c93100` over 12 h, near-black `#292929` no report. | ESM, Shelter Locator | Local |
| Large Animal Shelters | point | Large animal sheltering | Same status palette as ESM | ESM | Local |
| Distribution Sites | point | Points of distribution; commodity flags (water, ice, food, tarps, sandbags, hygiene, medical, comfort kits, pet) | Black circle with white flag, 18 px | EMO | Local |
| Incident Facilities | point | ICP, Staging Area, Incident Base, Camp | ICP as the ICS blue and white diagonally split square; Staging as dark grey circle with white "S"; Base and Camp as dark grey circles with white tent or shelter glyph, 18 px | EMO | Local |
| Critical Infrastructure | point | Facilities by the 16 CISA sectors | 22 by 16 px dark grey rounded rectangles with a white pictogram per sector (chemical, commercial, communications tower, manufacturing, dam, defense, emergency services beacon, energy, bank, food, government columns, healthcare heart, IT monitor, nuclear trefoil, highway, water drop) | EMO, HMP, CRR | Local; sector list from [CISA](https://www.cisa.gov/topics/critical-infrastructure-security-and-resilience/critical-infrastructure-sectors) |
| Community Lifelines (table) | none | Status of 8 lifelines with description per lifeline | Not mapped; dashboard cards colored by status (section 3) | EMO, IAA | Local |
| Damage Reports (IA) | point | Private property damage by FEMA degree | CIM circle 15.75 pt: Affected `#ffd700`, Minor `#e89d00`, Major `#c93100`, Destroyed `#8335a8` (purple), Inaccessible `#007ac2`, Unaffected `#58595b` | Damage Assessment | Local |
| IA Assignments (workflow) | point | Report workflow status | Simple circles 13.5 pt, 45 percent black outline: Submitted `#d92b30`, Assigned `#5391fc`, Completed `#00b81f`, Inactive `#a1a1a1`, Duplicate `#ab30fc`, Invalid `#f0ce24` | Damage Assessment | Local |
| Public Assistance | point | Public facility damage by FEMA PA category | CIM circle: A Debris Removal `#e89d00`; B Emergency Protective Measures `#fb7d81`; C Roads and Bridges `#b2b2b2`; D Water Control Facilities `#1f7ac0`; E Buildings, Equipment and Content `#875a46`; F Utilities `#58595b`; G Parks, Recreation, Other `#71d56e` | Damage Assessment | Local |
| PA Assessment Area / Trace | polygon, line | Drawn assessment extents | Fill `#cf172c` at 19 percent, outline `#ff0008` 1.25 pt; trace red 1.25 pt | Damage Assessment | Local |
| Debris Areas / Routes | polygon, line | Assessment and removal progress | 40 percent fills, grey outline: Unassigned `#990b0b`, Assigned `#ffffbf`, In Progress `#7f7f7f`, 1st pass `#a0c5af`, 2nd pass `#549670`, Complete `#1b7340` (a sequential red to green progression) | Debris | Local |
| Debris Assessments | point | By FEMA debris type (vegetative, C&D, hazardous limbs, white goods, e-waste, HHW, vehicles and vessels, soil, personal property) | PNG icons per type | Debris | Local |
| Historical Hazard Events | point, line, polygon | Past events, 19 types, declaration flags | Service default red sphere, purple `#a553b7` lines, blue `#4c81cd` 75 percent areas; per-hazard maps filter by type | HMP | Local; seed from NOAA Storm Events (PD) |
| Hazard Mitigation Projects | point, polygon | Projects by type and funding | Amber `#e89d00` CIM circle; areas amber at 75 percent with black 1.5 pt outline | HMP | Local |
| Area of Interest | polygon | Planning jurisdiction | Blue `#4c81cd` at 75 percent, black 0.75 pt | HMP | Local |
| Fire Districts / Stations | polygon, point | Response districts | Hollow, red `#d90012` 1.1 to 1.25 pt outline; stations clustered | CRR, Pre-Incident Planning | Local |
| Pre-Incident Plans and site considerations | polygon, point | Target buildings by review status; utility shutoffs, key boxes, FDCs, access, alarm panels, hazmat | Plans: Reviewed `#336887`, Site Visit Completed `#288835`, Assigned `#da4d1e`, Unassigned `#7a7a7a` at 65 percent. Site symbols follow NAPSG preplan colors: shutoffs navy `#050582`, key boxes green `#058205`, access green `#007800`, suppression dark red `#980405`, alarm red `#fc0505`, hazmat NFPA 704 diamond. Visible only at 1:2,500 and larger. | Pre-Incident Planning | Local |
| Special events, event areas, lines, assets | mixed | Venues, perimeters, hot and cold zones, HLZs, grandstands, first aid | Events by type CIM circles; areas grey `#58595b` at 10 percent with 4 pt outline | Special Event Operations | Local |
| Watch Areas, Location Points and Polygons | mixed | Monitored locations and buffers | 50 to 75 percent opacity, visible at 1:1,500,000 and larger | Watch Center | Local |
| Named Areas of Interest, Military Facilities | mixed | DSCA planning features | Solution styles | IAA, Civil Support | Local |
| Parcels (Community Parcels) | polygon | Ownership parcels | Hollow, black 0.4 pt outline | Community Data Aggregation; parcel ID lookup in Damage Assessment | Local authoritative (county assessor) |

### 2b. Reference layers consumed from Living Atlas, federal services and NAPSG

| Layer | Geom | Depicts | Symbology / scale | Used by | Source / License |
|---|---|---|---|---|---|
| USA Structures | polygon | Every structure over 450 sq ft, with `OCC_CLS` (Residential, Commercial, Agriculture, Industrial, Government, Education, Assembly, Utility and Misc, Unclassified) and `PRIM_OCC` (e.g. Single Family Dwelling, Multi-Family, Manufactured Home, Temporary Lodging, Institutional Dormitory, Nursing Home, Retail Trade, Hospital, Emergency Response, General Services, Pre-K to 12 Schools, Colleges/Universities, Religious, Light or Heavy Industrial), height, sq ft, address, USNG, census code | Single fill `#fceab5`, `#6e6e6e` 0.7 pt outline, drawn only at 1:80,000 and larger (about web zoom 12.9). Esri does not symbolize it by occupancy in the EM maps; occupancy is exposed through the popup. | EMO (off by default), CRR, IAA | FEMA and ORNL; FEMA download and [figshare](https://www.nature.com/articles/s41597-024-03219-x) are PD; Esri copy Esri-CC ([item](https://www.arcgis.com/home/item.html?id=0ec8512ad21e4bb987d7e848d14e7e24)) |
| Microsoft Building Footprints | polygon | 129.6 M US footprints | Feature and tile versions | NAPSG SA map | ODbL ([GitHub](https://github.com/microsoft/USBuildingFootprints)) |
| Overture buildings | polygon | Conflated OSM, Esri Community Maps, Microsoft, Google footprints | n/a | (not in Esri EM maps) | ODbL ([Overture](https://docs.overturemaps.org/attribution/)) |
| Regrid Nationwide Parcel Boundaries | polygon (tiles) | 100 percent US parcel lines; attributes sold separately | Tile layer | Living Atlas partner | Commercial, Regrid terms ([item](https://www.arcgis.com/home/item.html?id=a2050b09baff493aa4ad7848ba2fac00)); not bundle-able |
| American Indian, Alaska Native and Native Hawaiian Areas (AIANNH) | polygon | Federal and state reservations, off-reservation trust land, joint-use areas, ANVSAs, OTSAs, TDSAs, SDTSAs, Hawaiian Home Lands | Unique value by type at 50 percent with grey 0.75 pt outline: Federal AIR / ORTL `#ed5151`; Joint-Use AIR `#3caf99`; State AIR `#ffde3e`; ANVSA `#149ece`; Hawaiian Home Land `#a7c636`; OTSA `#fc921f`; TDSA `#f789d8` | Living Atlas | Census TIGER (PD); Esri copy Esri-CC ([item](https://www.arcgis.com/home/item.html?id=70c973c7e48949f9845e320f3b79a1d7)) |
| BIA AIAN Land Area Representations (LAR) | polygon | Exterior extent of trust and restricted-fee land for federally recognized tribes (fields LARNAME, CLASSIFICATION, GISACRES, REGION) | Single fill `#f5ca7a`, `#cccccc` 0.5 pt | BIA | BIA Branch of Geospatial Support; public information with a no-legal-inference disclaimer ([item](https://www.arcgis.com/home/item.html?id=e21128c26386412ca682accf7a57361a), [MapServer](https://biamaps.geoplatform.gov/server/rest/services/DivLTR/BIA_AIAN_National_LAR/MapServer/0), [data.gov](https://catalog.data.gov/dataset/bia-aian-land-area-representations-map)) |
| Tribal census tracts, block groups, subdivisions | polygon | Tribal statistical geography | n/a | Living Atlas | Census (PD); Esri-CC |
| USA Census Counties (detailed and generalized) | polygon | County boundaries, zoom-switched pair | Detailed when zoomed in, generalized when zoomed out | NAPSG SA map | Census (PD) |
| U.S. National Grid 100 m / 1 km / 10 km / 100 km / GZD | polygon | USNG grid for field navigation | Grid lines, visibility by level | Damage Assessment, Debris | FGDC; Esri item Esri-MLA ([item](https://www.arcgis.com/home/item.html?id=d96095fb637846889fb0e46ce69e3967)); computable locally |
| State Emergency Operations Centers | point | State EOCs | Solution style | IAA (Safety and Security) | FEMA `gis.fema.gov` (PD) |
| Police Stations; Prisons and Correctional Facilities | point | Law enforcement | Clustered | IAA (Safety and Security) | Esri-hosted federal structures layers (formerly HIFLD Open) |
| Military Installations, Ranges and Training Areas (MIRTA) | polygon | DoD sites | n/a | IAA | DoD (PD) |
| US Capitol, State Capitols, State Supreme Courts, Courthouses, City and Town Halls | point | Government landmarks | Clustered | IAA | Esri-hosted federal structures layers |
| Hospitals and Medical Centers; Fire Stations and EMS Stations; Ambulance Services | point | Health and emergency services | Picture markers | IAA (Health and Medical) | Esri-hosted federal structures layers; originals via [HIFLD crosswalk](https://www.datalumos.org/datalumos/project/241367/version/V1/view) |
| Nursing Homes | point | CMS certified nursing facilities | n/a | IAA, NAPSG SA map | CMS Provider Info (PD) |
| Power Plants in the U.S. | point | Generation facilities | Clustered | IAA (Energy) | EIA (PD) |
| EPA Wastewater Treatment Plants | point | FRS wastewater facilities | n/a | IAA (Water Systems) | EPA FRS (PD) |
| EPA Active Hazardous Waste (RCRA); Hazardous Waste TSD | point | Hazmat handlers | n/a | IAA (Hazardous Materials; the only hazmat proxy found; no Tier II layer) | EPA FRS (PD) |
| OpenStreetMap Shops for North America | point | Grocery and retail for food, hydration, shelter | n/a | IAA | OSM, ODbL |
| Hurricane Evacuation Routes | line | Designated routes | Interstate `#912900` 3.75 pt, Federal `#b35933` 3 pt, State `#fd7f6f` 2.5 pt, Street `#a7c636` 2.25 pt | IAA (Transportation) | Formerly HIFLD Open (PD) |
| Cellular Towers | point | FCC antenna structures | Clustered | IAA, NAPSG SA map | FCC (PD) |
| Public and Private Schools | point | NCES school locations | n/a | NAPSG SA map | NCES (PD) |
| Mobile Home Parks | point | High-vulnerability housing | n/a | NAPSG SA map | Formerly HIFLD Open (PD) |
| Dialysis centers, pharmacies, substations, dams, bridges, airports, heliports, ports | point | Remaining critical facility types requested | Not present in any Esri EM template web map inspected; available as NAPSG icons (Kidney Dialysis Centers, Pharmacies, Electricity Substations, NBI Bridges, commercial and GA airports, heliports, Major US Port Facilities) | none (gap in Esri too) | Originals: CMS dialysis facilities, NID dams (USACE), NBI bridges (FHWA), FAA airports and heliports, USACE/BTS ports (all PD). Substation sources vary; confirm each via the HIFLD crosswalk. Tier II chemical facilities are held by states and LEPCs, not a national open layer. |
| USA Weather Watches and Warnings | polygon | Active NWS products | Unique value on `Event` using the official NWS hazard colors (e.g. Tornado Warning `#ff0000`, Blizzard Warning `#ff4500`, Coastal Flood Warning `#228b22`, Avalanche Warning `#1e90ff`, Civil Danger Warning `#ffb6c1`), fill and 0.4 pt outline, layer opacity 0.25 in Watch Center | EMO, Watch Center, IAA, SEO, NAPSG | NWS (PD) via [NWS color table](https://www.weather.gov/help-map); Esri feed Esri-MLA ([item](https://www.arcgis.com/home/item.html?id=a6134ae01aad44c499d12feec782b386)) |
| NOAA Short-Term Warnings (tornado, severe thunderstorm, flash flood, special marine) | polygon | Storm-based warnings | Tornado: hollow, red `#ff0000` 2 pt outline | IAA, NAPSG | NWS (PD); Esri-MLA feed |
| USA Storm Reports (24 h, week) | point | LSR tornado, wind, hail | Unique value on INCIDENT_CODE | EMO, Watch Center, IAA | NOAA SPC (PD); Esri-MLA feed |
| Current Weather and Wind Stations, Buoys, Poor Visibility | point | METAR observations, flight category | Wind barbs; flight category colors | EMO, IAA | NOAA (PD); Esri-MLA feed |
| USA Radar | raster | Base reflectivity | Opacity 0.5, off beyond 1:85,000 in Watch Center | Watch Center, SEO, NAPSG | NOAA `mapservices.weather.noaa.gov` (PD) |
| NDFD Snowfall, Ice Accumulation, Wind Gust forecasts | polygon | Forecast grids | Graduated | IAA | NWS NDFD (PD) |
| Active Hurricanes, Cyclones and Typhoons | mixed | Forecast cone, track, positions, wind radii, watches and warnings | 3-day cone `#e1e1e1`, 5-day cone `#ebebeb` at 73 percent, white 1.5 pt outline, layer opacity 0.55; positions as PNG by development level (Tropical Low to Major Hurricane); storm names uppercase labels | EMO, Watch Center, IAA | NHC and JTWC (PD); Esri-MLA feed ([item](https://www.arcgis.com/home/item.html?id=248e7b5827a34b248647afb012c58787)) |
| USA Current Wildfires: perimeters and incidents | polygon, point | IRWIN wildfire and Rx perimeters; incidents by size class | Perimeters: Wildfire `#f7ada4` at 54 percent with `#e60c0c` 0.64 pt outline, Prescribed `#e8bd71` with `#e5a53e`; drawn at 1:2,500,000 and larger. Incidents: PNG flame markers by acreage (0 to 999 up to 300,000+), New (24 h), Complex, Rx; uppercase name labels | EMO, Watch Center, IAA, NAPSG | NIFC WFIGS (PD, [open data](https://data-nifc.opendata.arcgis.com/datasets/nifc::wfigs-current-interagency-fire-perimeters/about)); Esri-MLA feed ([item](https://www.arcgis.com/home/item.html?id=d957997ccee7408287a963600a77f61f)) |
| VIIRS and MODIS Thermal Hotspots | point | Satellite fire detections | Graduated by age | IAA, NAPSG | NASA FIRMS (PD) |
| USGS Recent Earthquakes: events by magnitude | point | Quakes with PAGER alert | Class breaks circles: under 3 `#a8a8a8` 3 pt; 3 to 4.5 `#6ceae6` 5.25 pt; 4.5 to 6 `#f2e643` 7.5 pt; 6 to 7.5 `#fc0316` 13.5 pt; 7.5 plus `#242424` 16.5 pt; magnitude labels | Watch Center, IAA, NAPSG | USGS (PD) |
| USGS Shake Intensity (ShakeMap MMI) | polygon | MMI contours | Class breaks, no outline: I to III transparent; IV `#f7bfc5`; V `#f5a0a6`; VI and VII `#f06167`; VIII `#ed4147`; IX `#eb2128`; X+ `#e80208`; layer opacity 0.6; drawn at 1:6,000,000 and larger | Watch Center, IAA, NAPSG | USGS (PD) |
| Live Stream Gauges | point | NWS AHPS flood category | Major `#b50000` 7.5 pt, Moderate `#f73500` 6 pt, Minor `#ff8b00` 5.25 pt, Action `#f2ca00` 4.5 pt, Low Flow `#c1976f`, Unknown `#72d2e8` small, No Flooding white square | Watch Center, IAA, NAPSG | NOAA NWPS (PD) |
| USA Flood Hazard Areas (NFHL reduced set) | polygon | FEMA SFHA and 0.2 percent zones | Esri simple pink `#fcc7d2` with grey 0.7 pt outline, 1:1,000,000 and larger; IAA uses a unique value on `esri_symbology` by zone class | HMP, IAA | FEMA NFHL (PD); Esri copy |
| National Risk Index (tracts and counties) | polygon | Composite and per-hazard risk ratings (18 hazards) | Unique value on `*_RISKR`: Very High `#c7445d`, Relatively High `#e07069`, Relatively Moderate `#f0d55d`, Relatively Low `#509bc7`, Very Low `#4d6dbd`; 25 percent black 0.9 pt outline; group opacity 0.65; tracts at about 1:700,000 and larger, counties at smaller scales | HMP, CRR | FEMA (public data under FEMA API terms) ([tracts item](https://www.arcgis.com/home/item.html?id=9da4eeb936544335a6db0cd7a8448a51)) |
| CDC/ATSDR SVI 2020 and 2022 | polygon | Social vulnerability percentile | Four-class YlGnBu on RPL_THEMES: 0 to 0.25 `#ffffcc`, to 0.5 `#a1dab4`, to 0.75 `#41b6c4`, to 1.0 `#225ea8`, no outline; a 45 degree hatch appears in the HMP SVI layer | HMP, CRR | CDC: "available to the public at large with no constraints" ([item](https://www.arcgis.com/home/item.html?id=414c0b43a0ec4adc829d5815bc621750)) |
| FEMA Community Resilience Challenges Index (CRCI) | polygon | Resilience challenges | Tract and county pair, opacity 0.75 | HMP, CRR | FEMA (PD) |
| USA Wildfire Hazard Potential; WRC risk reduction zones; WRC population density | polygon, raster | Wildfire hazard and exposure | Risk zones: Minimal `#b9bbc2`, Indirect `#f5c766`, Direct `#ff3b54`, transmission zones tree `#38a800`, shrub `#d7c29e`, grass `#a3ff73`, agriculture `#ffbee8`; population 7-class purples `#e5d5f2` to `#5d2c70` | HMP, Wildfire Protection Planning | USFS (PD) |
| MTBS burn and prescribed burn perimeters | polygon | Historical fires 1984 to 2024 | Class breaks by year, older lighter: fire `#cdc1b6` to `#d43500` with `#6b0000` 1.5 pt outline; Rx `#d8e3de` to `#018c6e` with `#223127` outline | Wildfire Protection Planning | USFS and USGS MTBS (PD) |
| Global WUI; Sentinel-2 and ESA land cover; NLCD | raster | Context | Image services | HMP, WPP | Mixed (Esri image services Esri-MLA; NLCD PD) |
| Qfaults, Global Earthquake Archive, IBTrACS, Tornado Tracks 1950 to 2017, Windstorm Paths, USDM Drought, NA Climate Zones, Heat Severity 2023 | mixed | Hazard history | Qfaults by age (e.g. Historic `#2c6954`, Latest Quaternary `#695529`) 1.5 pt | HMP | USGS, NOAA, USDM (PD); Heat Severity from Trust for Public Land (terms apply) |
| Esri Updated Demographics | polygon | Population density | Class breaks | HMP | Esri-MLA (not bundle-able; substitute Census ACS, PD) |
| World Traffic | raster | Live traffic | n/a | Watch Center, SEO | Commercial (not bundle-able) |
| Basemaps: Community Map (most), Light Gray Canvas, Dark Gray Canvas, Imagery, Imagery Hybrid, Streets, Navigation, Topographic, Human Geography, OpenStreetMap | tiles | Base cartography | Esri vector basemaps | all | Esri-MLA; Esri terms bar exporting or redistributing basemap caches except through "for export" services inside ArcGIS apps ([Esri E300](https://www.esri.com/content/dam/esrisites/en-us/media/legal/product-specific-terms-of-use/e300.pdf)); OSM basemap is ODbL |
| NAPSG Crisis Communication Catalog; GISCorps crowdsourced disaster photos; NWS Damage Assessment Toolkit tornado tracks | mixed | Volunteer and NWS post-event data | n/a | NAPSG SA map | NAPSG, GISCorps (volunteer terms); NWS DAT (PD) |
| Tsunami inundation / evacuation zones | polygon | Tsunami hazard | Not present in any Esri EM template map inspected; NWS tsunami warnings arrive through the Watches and Warnings layer | none | State geological surveys and NTHMP (terms vary by state) |

---

## 3. Symbology and legend conventions

**Point symbols.** Esri's current EM templates use one consistent family: a CIM vector marker made of a solid colored circle (a 21 by 21 unit frame) with a white pictogram, a black outline at 25 percent opacity and 0.42 to 0.5 pt width, drawn at 13.5 to 18 pt (about 18 to 24 px). Color carries the meaning (category family or status), the glyph carries the type. The palette is Esri's public-safety set, reused across solutions: red `#c93100`, amber `#e89d00`, blue `#007ac2`, grey `#58595b`, greens `#83c96e` and `#71d56e`, brown `#6c4000`, purple `#8335a8`, gold `#ffd700`, pink `#fb7d81`, brown `#875a46`. Status is always a unique-value renderer on a coded-domain status field, so the legend label is the domain description (e.g. "Mandatory Evacuation Order", not "Level 3"). Workflow maps (manager and dashboard maps) drop pictograms and use plain colored circles by report status. Older sector and facility icons are 18 to 22 px PNG picture markers: critical infrastructure as dark grey rounded rectangles with white sector pictograms; incident facilities as dark grey circles, except the ICP which keeps the ICS blue and white split square. No template uses plain dots for final operational symbology; dots appear only as unconfigured service defaults (e.g. 4 pt black circles) that the web maps override.

**NAPSG conventions** (used by the community and partly by Esri's preplan colors). NAPSG's library (v4.1.5 manifest, 13 packs) has USAR (25 symbols), Access Hazards (48), Preplan (218), Resources (82 NIMS resources), NIMS Positions (96), Human Caused Hazards (14), Public Alert and Warnings (54, one per IPAWS event code, warning triangles), Incident (102: intelligence and resources, including ICP, EOC, JOC, MACC, base, camp, staging, barriers, decon), Natural Hazards (12), Hazardous Materials (42), Lifelines (278) and Infrastructure (226 across agriculture, chemical, commercial, communications, education, emergency services, energy, finance, government, law enforcement, public health including hospitals, pharmacies, dialysis and nursing homes, public venues, air, ground and water transportation, water supply) and Hazard Points (42). Infrastructure icons are black pictograms on a white rounded square with a black border (highway-sign style). Lifeline icons are the FEMA lifeline pictogram in a white disc with a navy ring, wrapped in a status halo in green, yellow, red or grey, each in "icon only" and "with label" variants. USAR structure marks use diamonds. Symbols ship as 128 px PNG and SVG, ArcGIS Pro styles and ArcGIS Online web styles, under CC BY 4.0 for commercial use ([NAPSG library](https://www.napsgfoundation.org/all-resources/symbology-library/), [tool](https://napsg-web.s3.amazonaws.com/symbology/index.html), [manifest](https://napsg-web.s3.amazonaws.com/symbology/napsg_symbology_v4.1.5.json)). The tool page states it will be deprecated on 2027-03-01 with a replacement "coming soon".

**Community lifeline status colors.** FEMA toolkit 2.1 (07/2023) defines Grey = Unknown, Red = Significant Impact, Yellow = Moderate Impact, Green = Minimal Impact, Blue = Administrative (not an operational status). Esri's EMO dashboard encodes these exactly as Minimal `#5E9C42`, Moderate `#FBBA16`, Significant `#C52038`, Unknown `#919395`, Administrative `#015287`, one card per lifeline with the lifeline icon, name, a colored status bar and the free-text description. The eight lifelines in the Esri schema: Safety and Security; Food, Hydration and Shelter; Health and Medical; Energy; Communications; Transportation; Hazardous Materials; Water Systems ([FEMA lifelines](https://www.fema.gov/emergency-managers/practitioners/lifelines), [toolkit v2.1](https://www.fema.gov/sites/default/files/documents/fema_lifelines-toolkit-v2.1_2023.pdf)).

**Damage colors.** Esri does not use the red-to-green severity ramp many expect. The Photo Viewer uses Affected gold, Minor amber, Major red-orange, Destroyed purple, Inaccessible blue, Unaffected grey. Nothing in FEMA's PDA guide prescribes colors; the guide only defines the categories.

**Polygons.** Status polygons (notices and evacuations) are 50 percent fills with a 1.5 pt outline in the same hue, so overlapping areas stay readable and the boundary stays crisp. The "no order" baseline is an almost invisible fill with a thin grey outline so zones stay clickable. Emphasis areas (impacted area) are hollow with a thick 3 pt colored outline. Choropleths (NRI, SVI, CRCI) use solid fills with a 25 percent black hairline and layer opacity 0.65 to 0.75 over the basemap. Pre-established zones use solid fills, no outline, 30 percent transparency, labeled with the zone name. Hatching is almost never used: only IAA's Area Road Disruptions (backward diagonal) and one SVI layer in HMP (45 degree) in all 20 templates checked. Transparency is set either in the symbol alpha or as layer opacity, not both.

**Lines.** Two-layer casings for routes: evacuation routes are blue 2 pt over a pale yellow 4 pt halo; detours orange over white. Closures are red with arrow vector markers along the line to show direction.

**Labels.** Sparse. Labels are on for zone names (Know Your Zone), storm names and wildfire incident names (uppercase Arcade), quake magnitudes, road names in transportation reference maps and a few HMP layers. Operational layers rely on popups rather than labels.

**Scale dependence** (Esri scale, then approximate web zoom on 256 px tiles; subtract one for MapLibre's 512 px convention): USA Structures 1:80,000 (z12.9); IAA Foundational Infrastructure group 1:51,813 (z13.5); preplan site considerations 1:2,500 (z17.9); Special Events road closures 1:20,000 (z14.9); NFHL 1:1,000,000 (z9.2); NRI tracts in and counties out around 1:670,000 to 1:990,000 (z9.4 to 9.8), implemented as a pair of sublayers with complementary min and max scales; wildfire perimeters 1:2,500,000 (z7.9); ShakeMap 1:6,000,000 (z6.6); watch areas 1:1,500,000 (z8.6). Point reference layers with many features (police, courthouses, power plants, cell towers, fire stations, NFIRS incidents) use clustering; CRR also uses heat maps.

**Default visibility and filters.** Live-feed groups are off by default and operational layers on. Public and dashboard maps filter with definition expressions such as `activeincid = 'Yes' AND publicview = 'Yes'` and `status = 'Open'`, so the same service feeds internal, dashboard and public maps.

**Legend layout.** Map Viewer and app legends list only layers visible at the current scale, one heading per layer with a symbol patch and label per class; basemaps and map image layers do not appear; authors can hide a layer from the legend while keeping it on the map ([Map Viewer legend](https://doc.arcgis.com/en/arcgis-online/get-started/view-legend-mv.htm)). Because labels come from coded domains, legend text equals the pick-list text in forms. The Layer List widget groups layers by group layer, supports independent, exclusive (radio) and inherited visibility modes, greys out layers outside their scale range and can embed a legend, opacity slider and zoom-to action in each item ([LayerList](https://developers.arcgis.com/javascript/latest/api-reference/esri-widgets-LayerList.html)).

---

## 4. Map UX in these solutions

**App shells.** Internal work happens in Experience Builder apps; public work in Instant Apps and Hub sites; command views in Dashboards.

- EMO Emergency Information Manager (Experience Builder): 14 map widgets across tabbed pages (map incidents and impact, understand impact, manage notices and resources), 13 edit widgets, 13 list widgets, 13 filter widgets, feature info, a Business Analyst infographic and Near Me. Workflow is page-per-task with a list plus map plus edit form on each page.
- Watch Center (Experience Builder): Map Layers, Legend, Basemap Gallery, Bookmark, Directions, Print, Draw, Coordinates, Add Data, feature info, list, edit and Feature Report.
- Shelter Registration Management (Experience Builder): map, legend, list, filter, feature info.
- Public Information (Instant Apps Basic): legend, search (open at start), locate, basemap toggle.
- Damage Photo Viewer (Attachment Viewer): onboarding panel, zoom, image pan and zoom, only features with attachments, share, search.
- Shelter Manager and Mitigation Plan Feedback Manager (Instant Apps Manager): layer list and filter panel for table-style management.
- HMP: Portfolio Instant Apps (layer list, legend, scalebar, locate), Atlas (scalebar, grouped map catalog), Sidebar (edit panel).

**Widget inventory available** in Experience Builder: Map, Map Layers, Legend, Basemap Gallery, Bookmark, Search, Coordinates, Coordinate Conversion, Measurement, Draw, Print, Swipe, Timeline, Near Me, Directions, Elevation Profile, My Location, plus Filter, List, Table, Chart, Edit, Feature Info, Query, Select, Add Data ([widgets overview](https://doc.arcgis.com/en/experience-builder/latest/configure-widgets/widgets-overview.htm)). Instant Apps templates include Basic, Sidebar, Manager, Portfolio, Atlas, Attachment Viewer, Nearby, Compare, Countdown, Media, Public Notification, Reporter and others ([capabilities matrix](https://doc.arcgis.com/en/instant-apps/latest/create-apps/pdf/arcgis-instant-apps-matrix.pdf)).

**Pop-ups.** Titles are Arcade expressions (often forced uppercase). Fields shown, by layer: Incidents (incident ID, name, type, report time, description, location description, status, active, public); Notices (incident, description, agency URL, evacuation type, start and end date); Shelters (name, address, agency, Red Cross model, POC name, phone, email, status, large animal, warming, cooling, capacity, beds, occupancy, accessible, backup power, pets, access restrictions); Distribution Sites (commodities yes or no list and daily hours); Road Closures (street, direction, reason, lane impact, access allowed, start and end, alternate route, POC); Critical Infrastructure (name, facility ID and type, asset type, sector, address, municipality, phone, hours, POC, normal capacity); USA Structures (building ID, occupancy class, primary and secondary occupancy, address, height, square feet, elevations, census code, USNG, image date); Damage (lastreporttype title, owner or renter, narrative, level affected, utilities, immediate needs, damage areas, assigned to, dwelling type).

**Dashboards.** Command dashboards pair one map with indicators, lists and selectors. EMO Incident Status Dashboard: indicators for open shelters, distribution sites, active notices and evacuations, critical infrastructure, incident facilities and road closures; an incidents list; eight lifeline cards plus a past-conditions list. IA dashboard: indicators per damage level (Destroyed, Major, Minor, Affected, Inaccessible, Unknown) and category selectors for incident, dwelling type, owner or renter, insured, report status and report type. PA dashboard: indicators per PA category and total damages. Shelter Status: open and closed counts, occupancy percent for people, pets and large animals, occupancy and occupancy-history serial charts, and nine amenity filters (accessible, pets, backup power, charging, food, water, internet). Resource Planning: registrations over time, mode of transportation, guests by age (serial charts), primary language and shelter population (pie charts). Debris: volume by assessor, assessed volume by removal status and by debris type (pie), area by status, haulout by provider and type (serial), total volume and percent complete indicators, date and incident selectors. Charts and selectors drive filter, zoom, pan, flash and popup actions on the map and on other elements ([Dashboards actions](https://doc.arcgis.com/en/dashboards/latest/create-and-share/configuring-actions-on-dashboard-elements.htm), [charts as action source](https://doc.arcgis.com/en/dashboards/latest/create-and-share/charts-as-source-of-actions.htm)).

**Other behaviors.** Bookmarks ship in the Damage Assessment manager and PA dashboard maps (three each). Time: most layers have time info and editor tracking, used by dashboards and Experience Builder Timeline rather than a map time slider. Offline: survey and field web maps set offline download and sync of features and attachments. Search uses the World Geocoder. Near Me is used for "what is within X of the incident".

---

## 5. Gap list for an offline MapLibre implementation

This list assumes nothing about the current Open Source EOC map beyond the stack (MapLibre GL JS, PMTiles, offline, Windows and macOS). Each item names what parity needs and whether the data can ship in the installer.

### 5a. Data layers

| Need | Parity requirement | Can it be bundled offline? |
|---|---|---|
| Incidents (point, line, area), impacted area | Local editable layers with the 23-type domain and Esri family colors | Yes (local) |
| Notices and evacuations, pre-established zones A to F | Status polygons with the seven-status palette, zone palette, labels, public filter flags | Yes (local); zones are jurisdiction data |
| Evacuation routes, closures, blocks, detours | Line casings, arrow markers, no-entry point symbol | Yes (local) |
| Shelters, large animal shelters, distribution sites, incident facilities | Status-colored icons, occupancy fields, reporting freshness ring | Yes (local) |
| Critical infrastructure by 16 CISA sectors | Sector field and sector icon set | Yes (local); icons via NAPSG CC BY 4.0 with attribution, or original artwork |
| Federal critical facility seed (hospitals, fire, EMS, police, EOCs, schools, nursing homes, dialysis, pharmacies, power plants, substations, water and wastewater, cell towers, airports, heliports, ports, dams, bridges) | Pre-loaded per state or county extracts grouped by the eight lifelines, clustered, visible from about zoom 13 | Yes for federal originals: CMS (nursing homes, dialysis), NCES, FCC, EIA, EPA FRS, FAA, FHWA NBI, USACE NID, FEMA state EOCs. HIFLD Open is gone (updates stopped 2025-06-26, portal off 2025-08-26); use the DHS crosswalk to each originating agency, or the Data Rescue Project and HSDL snapshots. Verify license per layer; a few HIFLD layers were sourced from commercial vendors. Do not scrape Esri-hosted copies. |
| Building footprints with occupancy | Footprints drawn from about zoom 13, popup with occupancy, optional thematic by `OCC_CLS` | Yes: FEMA USA Structures from FEMA or figshare is PD and carries occupancy; Microsoft and Overture are ODbL (bundle with attribution and share-alike on derived databases). Esri's copy is CC BY. |
| Ownership (private, public) | Esri has no ownership symbology; it splits IA (private) and PA (public) at the damage-report level and uses Owner or Renter. Parity means a parcel layer plus a public-ownership flag. | Parcels: only local authoritative data (county assessor) or state open parcels; Regrid is commercial and not bundle-able. |
| Tribal lands | Census AIANNH classes with the seven-class palette; BIA LAR as authoritative trust land; tribe fields on damage and incident records | Yes: Census TIGER (PD) and BIA LAR (public, with BIA disclaimer text). |
| Jurisdiction boundaries | States, counties (detailed and generalized pair), places, tracts, fire districts, area of interest | Yes: Census TIGER/cartographic boundary files (PD); districts local |
| USNG grid | 100 m to 100 km and GZD, level switched by zoom | Yes: generate locally (FGDC standard), no data license needed |
| Damage assessment | Six-level FEMA degree palette, workflow status palette, PA categories A to G, assessment areas | Yes (local) |
| Debris | Area and route status progression, debris-type icons | Yes (local) |
| Live hazard feeds (NWS warnings, storm reports, METAR, radar, hurricanes, wildfires, hotspots, quakes, ShakeMap, stream gauges, NDFD) | Same symbology tables as above, cached last-known state for air-gap | Data is PD at the source (NWS, NHC, NIFC WFIGS, NASA FIRMS, USGS, NOAA NWPS). The Esri live-feed copies are Esri-MLA and must not be used. Offline means "last synced snapshot", with a visible age stamp. |
| Flood hazard (NFHL) | Zone-class polygons from about zoom 9 | Yes: FEMA NFHL (PD); state or county extracts are large, so ship per jurisdiction |
| Risk and vulnerability (NRI, SVI, CRCI, wildfire hazard, WRC) | Tract and county pair with complementary zoom ranges; exact palettes above | Yes: FEMA NRI (FEMA data terms, public), CDC SVI (no constraints), FEMA CRCI and USFS WRC (PD) |
| Historical hazards (Qfaults, IBTrACS, tornado tracks, MTBS, storm events) | Per-hazard thematic maps, as HMP ships | Yes (PD) |
| Tsunami inundation | Missing in Esri too | State data; license varies |
| Demographics for impact summary | Esri uses Business Analyst infographics (licensed) | Substitute Census ACS and decennial counts (PD) aggregated under the impacted area |
| Basemap | Community-style vector basemap, gray canvas (light and dark), imagery, OSM | Esri basemaps cannot be bundled. Use OSM-derived PMTiles (Protomaps or OpenMapTiles schema, ODbL) and, for imagery, USGS NAIP or USDA imagery (PD) where size allows. |

### 5b. Symbology and cartography engine features

1. Status-colored pictogram circles: render as SDF icons (`icon-image` with `sdf: true`) so one white glyph set can be tinted by `icon-color` from a `match` on the status field, plus a circle layer underneath or a baked two-tone sprite. MapLibre SDF icons are single color, so the Esri look (white glyph on colored disc) needs either a `circle` layer beneath a white SDF glyph, or pre-rendered sprites per color.
2. A palette table keyed by coded domain: every renderer above is a unique value on a domain code with the domain description as legend label. Store palettes as data (JSON) so the legend, the map style and the form pick lists share one source.
3. Halo status icons for lifelines (NAPSG style: icon plus colored ring) for the lifeline map layer, if lifelines are mapped per facility.
4. Line casings as two stacked `line` layers; direction arrows with `symbol-placement: line` and `icon-rotation-alignment: map`.
5. Hatch fills with `fill-pattern` sprites (only two Esri uses, low priority).
6. Scale ranges converted to `minzoom` and `maxzoom` (zoom = log2(591,657,527.6 / scale) minus 1 for MapLibre), including the tract and county switch pairs.
7. Clustering (`cluster: true` on GeoJSON sources) for dense reference points; heat maps for incident density (CRR).
8. Definition-expression equivalents as style `filter`s (active, public, open) so one source feeds internal and public views.
9. Label rules: zone names, storm names, incident names uppercase, magnitudes; everything else in popups.
10. Legend component that lists only layers visible at the current zoom, groups by layer, uses domain labels, supports hide-from-legend, and renders class-break and graduated-size patches (earthquake magnitudes, stream gauges).
11. Layer list with group layers, exclusive (radio) groups, grey-out when out of scale, per-layer opacity and zoom-to.

### 5c. Map UX features

Search (offline geocoder over local address points and gazetteer), bookmarks, measurement, draw and sketch, print to PDF with legend, swipe, time slider over timestamped layers (WebEOC also ships one, section 7), near me buffer summary, coordinates in lat and long plus USNG, add data (GeoJSON, KML, shapefile, CSV), basemap gallery (light, dark, imagery, OSM), popups with configured field lists and attachments viewer, layer filters by attribute, and public-view filtering.

### 5d. Dashboard charts (added scope)

Esri and WebEOC dashboards both need the following to reach parity with what their EM products ship:

- Indicator tiles: a single number with a colored header by status and a caption (Esri indicators; WebEOC status tiles). Needs count, sum and percent aggregations with a reference value and conditional color.
- Donut or pie charts with per-slice counts and percentages, labels on leader lines, and a full-screen toggle (WebEOC Checklist and Item Status; Esri pie charts for language, population, debris by type and status).
- Serial charts: vertical bars by category (WebEOC Category, Capability Element), horizontal bars, and time series (Esri occupancy history, registrations over time, volume by provider).
- Lists with status chips, progress bars ("x of y" and percent), and last-updated stamps (WebEOC checklists and IAP forms).
- Status-card grids such as the eight lifeline cards with icon, name, status color bar and description.
- Selectors (category, date, number) and cross-filtering: clicking a slice, bar or tile filters the map and the other widgets, and a "view" drill-down opens the filtered list.
- Color discipline: status palettes shared with the map (e.g. lifeline green, yellow, red, grey, blue; shelter status; damage level) so a chart slice and a map symbol for the same value always match.
- Dark mode (WebEOC added dark variants of every board dashboard in 2025).
- All charts must work from local data with no external charting service, which fits an offline build.

---

## 6. Verification notes

All hex values in sections 2 and 3 were decoded from the solution templates retrieved on 2026-09-26 (items listed in section 9). The PNG-based icons (critical infrastructure sectors, incident facilities, shelters, distribution sites, road blocks) were extracted from the templates' embedded image data and inspected visually; their descriptions are from that inspection. Esri's narrative docs occasionally lag the templates (for example, EMO docs say shelter status values but give no colors; the Damage Assessment docs mention "Submitted (red)", which matches `#d92b30`).

---

## 7. WebEOC chart dashboards and map integration (added scope)

Juvare WebEOC Nexus boards that carry a Dashboard tab share one visual system: a row or grid of **status tiles** (colored header bar with the status name and a small round icon button at right, a large centered count, and a caption such as "Pending Status AARs"), followed by **charts** in cards with a title, a full-screen button at the lower right, and (since the November 2023 redesign) search and filter. Colors are green, orange or yellow, red and grey. Sources: [board list](https://docs.juvare.com/webeoc-onnexa/board-list/board-list.htm), [standard boards](https://confluence.juvare.com/display/PKC/Standard+WebEOC+Boards).

**After Action Review board.** Tabs: After Actions, After Actions (All Incidents), Improvement Plan, Improvement Plan (All Incidents), Dashboard. The documented dashboard (light and dark screenshots) shows three tile rows: AAR priority (Low green, Medium orange or yellow, High red, with counts), AAR status (Pending, Open, Closed, Not Applicable in grey), Improvement Plan disposition (Pending, Included, Not Included in grey), then a **Capability Element** vertical bar chart (Equipment, None, Training, Organization, Exercise, Planning). Release notes record the November 14, 2023 dashboard redesign (full-screen charts, search and filter), a September 25, 2024 fix to Pending and Open colors and to the Capability Element chart legend and title, a January 2025 change so Core Capability and Capability Element are no longer auto-populated, improvement-item assignment to positions (December 2025), dark mode (May 2025), and comments and share (1.5.2, June 25, 2026). The board supports HSEEP-style tracking with owners and deadlines. The coordinator's description of donut charts for AAR Priority, AAR Status and Improvement Plans with totals, per-slice counts, percentages and VIEW links, and a horizontal Core Capability bar chart, is **not shown in Juvare's public documentation**, which shows tiles for those three measures; it likely reflects a newer build, a DesignStudio (DS) variant (AAR DS 1.0 shipped August 22, 2024) or a local configuration. Treat those specifics as observed-in-product rather than documented. Sources: [AAR board](https://docs.juvare.com/webeoc-onnexa/board-list/board-after-action-review.htm), [AAR release notes](https://docs.juvare.com/webeoc-onnexa/board-list/board-after-action-review-release-notes.htm), [AAR DS setup](https://docs.juvare.com/webeoc-onnexa/board-list/set-up-after-action-review-ds-board.htm).

**Checklist board.** Tabs: My Checklists, Activated Checklists (All), Checklist Templates, Dashboard. Dashboard: three tiles (Not Started red, In Progress orange, Completed green, each "Total Checklists ..."), two donut charts, **Checklist Status** and **Item Status**, with percentage labels on leader lines (e.g. "Completed: 49.80%", "Not Applicable: 0.40%"), and a **Category** vertical bar chart with multicolor bars; each chart has a full-screen button. List view: header chips with counts (0 NOT STARTED red, 2 IN PROGRESS orange, 5 COMPLETED green), a FILTER/SEARCH button, and rows with checklist name, category, activation date, a **progress** block showing percent in large type, "3 of 17", a horizontal bar (orange partial on a pale track, green when complete) and "Last Updated", plus description and a row menu. Item statuses: Not applicable, Not started, In progress, Completed, with Progress Notes and Revert or Progress Item actions. "Pace", "Tasks by Category", "Lists by Status" chart names and a "Past Due" chip were **not found** in public docs. Sources: [Checklist board](https://docs.juvare.com/webeoc-onnexa/board-list/board-checklist.htm), [Checklist user guide](https://docs.juvare.com/webeoc-onnexa/board-list/checklist-user-guide/checklist-user-guide-overview.htm), [release notes](https://docs.juvare.com/webeoc-onnexa/board-list/board-checklist-release-notes.htm).

**Incident Action Plan board.** Covers 19 ICS forms (200 to 233) with data flowing between forms, drafts, approvals with signatures, operational periods, and unlimited IAPs. The documented working-IAP view shows Incident Details (title, operational period from and to), an Approvers block (name, title, date and time approved), and a form table: ICS Form, Form Title, **Status chip** (COMPLETE green, IN PROGRESS orange, and Not Started), **Assigned To** position chips in navy, Last Updated (user and timestamp), an **Include in IAP** toggle, and a row menu; header actions Configure Branches and Divisions, View IAP, Update. Status tiles with totals ("5 Not Started, 3 In Progress, 45 Complete") and per-row progress bars on the IAP list are not in the public screenshots. Sources: [IAP board](https://docs.juvare.com/webeoc-onnexa/board-list/board-incident-action-plan.htm), [IAP user guide](https://docs.juvare.com/webeoc-onnexa/board-list/iap-user-guide/iap-user-guide-overview.htm), [IAP release notes](https://docs.juvare.com/webeoc-onnexa/board-list/board-incident-action-plan-release-notes.htm).

**Requests/Tasks board.** Tabs: Requests/Tasks, Deployments, Finance, Dashboard. Tiles: Total Active Requests (orange), Total Completed/Closed (dark), Total Requests (cyan), Total Deployments (cyan), Total Cost (green, currency, "$352.0k In Deployment Costs"), Recent New Requests (24 h), Recent Completed/Closed (24 h), Overdue Requests (red), then a Request Statuses chart. The dashboard shows overdue items on the day they are late (fixed in a later release). NIMS resource typing lists follow FEMA. Sources: [Requests/Tasks board](https://docs.juvare.com/webeoc-onnexa/board-list/board-requests-tasks.htm).

**Other boards with status or charts:** Situation Report with Community Lifelines (premium; lifeline status across the eight lifelines), Shelters with Registration (premium; occupancy tracking), Facility Status, Distribution Sites, Damage Assessment and Road Closures (State and Local set), Event Reporting (significant events log), PowerOutage.com, Facility Status with WeatherOptics, Drone Tracking, FleetUp asset tracking, and SenseNet wildfire detection (the last four are map-centric add-ons). Board list: [link](https://docs.juvare.com/webeoc-onnexa/board-list/board-list.htm).

**Dashboards in WebEOC** are layouts that combine several boards or maps into one screen with per-board filters; admins publish them by feature group and users can build their own from an allowed set ([Dashboards](https://docs.juvare.com/webeoc-onnexa/help/dashboards/about-dashboards.htm)).

**WebEOC mapping.**
- **Maps** (standard with WebEOC Nexus): "Built on the Esri ArcGIS platform"; plots board records, annotations, asset locations, measurement, 2D and 3D; clustering, heat maps, topography, multiple basemaps (separate light and dark basemaps), address and POI search, and a new geocoder ([Maps](https://docs.juvare.com/webeoc-onnexu/help/mapping/maps/about-maps.htm), [Mapping overview](https://docs.juvare.com/webeoc-onnexa/help/mapping/about-mapping.htm)).
- **Maps Add-On** (licensed): custom geocoder, **external map layers** (Esri Map Service, Esri Feature Service, WMS, GeoRSS and similar, with Local ArcGIS or ArcGIS Online OAuth credentials), 3D scenes, and import of an ArcGIS Online **WebMap (2D) or WebScene (3D) by portal ID** with OAuth client or token authentication (including partner providers such as ICEYE) ([Create a Map](https://docs.juvare.com/webeoc-onnexa/help/mapping/mapping-manager/create-map.htm), [Create a Map Layer](https://docs.juvare.com/webeoc-onnexa/help/mapping/mapping-manager/create-map-layer.htm)).
- **Time Slider**: the Esri ArcGIS time slider widget, integrated to play board layers and external layers over ten equal steps; off by default ([Timeline](https://docs.juvare.com/webeoc-onnexa/help/mapping/mapping-manager/view-data-on-timeline-on-maps.htm)).
- **MapTac**: a separate static-image map for briefings with draggable markers (push pins, fire trucks, road blocks), shapes, labels, print, and NWS alerts; no board data exchange.
- **Mapping Manager**: admin tool to create maps, add board layers and external layers, embed a map in a board, and assign maps to groups ([Mapping Manager](https://docs.juvare.com/webeoc-onnexa/help/mapping/mapping-manager/about-mapping-manager.htm)).
- **ArcGIS Extension for WebEOC** (licensed add-on): converts any board to an ArcGIS Online or Enterprise feature service so geocoded records appear in ArcGIS in near real time for use in ArcGIS Dashboards and apps; admin tabs WebEOC API, ArcGIS API, Feature Services, Recent History ([Juvare ArcGIS add-on](https://www.juvare.com/product-add-ons/arcgis/), [extension](https://www.juvare.com/products/boards/add-on/arcgis-extension-for-webeoc/)). The older **WebEOC Mapper Professional** was a joint ESi and Esri product that consumed ArcGIS Server, ArcIMS, OGC and ArcWeb services ([Esri partner listing](https://www.esri.com/partners/juvare-a2T70000000TNQCEA4/webeoc-mapper-profes-a2d700000013cCoAAI), [SecurityInfoWatch](https://www.securityinfowatch.com/home/article/10557858/webeoc-mapper-provides-the-power-of-gis-for-optimized-situational-awareness-decision-support-and-much-more)).

WebEOC therefore shows whatever layers the customer's ArcGIS portal or external services provide; Juvare does not ship a fixed EM layer catalog. Board records (significant events, requests, shelters, road closures, damage) are the native layers.

---

## 8. Veoci and Esri (added scope)

- **Partner status.** Veoci pages display an "Esri Partner Network Bronze" badge ([situational awareness page](https://veoci.com/government/situational-awareness/), [resource and asset management](https://veoci.com/emergency-management/resource-asset-management/), [integrations](https://veoci.com/downloadable/integrations/)). Veoci's dedicated Esri partnership page (`veoci.com/partners/esri/`) returned HTTP 404 on 2026-09-26, so the partnership details it once held could not be confirmed. No Veoci listing was found on the ArcGIS Marketplace or in public ArcGIS Online content owned by Veoci.
- **What the integration does, as evidenced.** Veoci's own copy is marketing-level: "Visualize hazards, team operations, and resource deployment as it's reported through GIS mapping" and "GIS mapping gives your EOC a complete resource and asset distribution picture." Evidence of actual use: the City of Stamford publishes an ArcGIS MapServer named `Veoci` exposing municipal reference layers (street centerlines, paving, leaf pickup zones, neighborhoods, police and municipal districts, parking meters, traffic signals, road and park polygons, storm and sanitary manholes, light poles, parcels) for Veoci to consume ([Stamford MapServer](https://www.stamfordgis.org/public/rest/services/Veoci/MapServer)); Honolulu DEM has a "DRAFT Veoci to ArcGIS Integration for Shelters" hosted feature service and a "Weather Dashboard - Veoci" ArcGIS dashboard ([item](https://www.arcgis.com/home/item.html?id=a7f158e0cda043c08163d997b32dc895)); Lake County, Illinois publishes "2017 Veoci Reports" as a feature service ([item](https://www.arcgis.com/home/item.html?id=857772f2edd04760b0aa9127d3223ecf)). This pattern (customer ArcGIS services read into Veoci maps; Veoci records exported to ArcGIS feature services by the customer) matches the repository's earlier finding that Veoci reads customer ArcGIS services but no feature-service write-back, OGC, KML or drawing tools surfaced (docs/process/VEOCI-PLATFORM-RESEARCH-2026-09-24.md).
- **Esri layers or capabilities exposed to Veoci users.** None documented publicly beyond "GIS mapping" of geolocated form entries with icons and colors by field value, layers and filters, plus whatever ArcGIS services the customer points it at. No Living Atlas bundle, lifeline layer set, or Esri dashboards embedding is documented.

---

## 9. Sources

Esri solution documentation
1. https://doc.arcgis.com/en/arcgis-solutions/latest/reference/introduction-to-emergency-management-operations.htm
2. https://doc.arcgis.com/en/arcgis-solutions/latest/reference/use-emergency-management-operations.htm
3. https://doc.arcgis.com/en/arcgis-solutions/latest/reference/configure-emergency-management-operations.htm
4. https://doc.arcgis.com/en/arcgis-solutions/11.5/reference/emergency-management-operations-faq.htm
5. https://doc.arcgis.com/en/arcgis-solutions/latest/reference/introduction-to-damage-assessment.htm
6. https://doc.arcgis.com/en/arcgis-solutions/latest/reference/use-damage-assessment.htm
7. https://doc.arcgis.com/en/arcgis-solutions/latest/reference/configure-damage-assessment.htm
8. https://doc.arcgis.com/en/arcgis-solutions/latest/reference/introduction-to-emergency-shelter-management.htm
9. https://doc.arcgis.com/en/arcgis-solutions/latest/reference/introduction-to-shelter-locator.htm
10. https://doc.arcgis.com/en/arcgis-solutions/latest/reference/introduction-to-know-your-zone.htm
11. https://doc.arcgis.com/en/arcgis-solutions/latest/reference/introduction-to-hazard-mitigation-planning.htm
12. https://doc.arcgis.com/en/arcgis-solutions/latest/reference/use-hazard-mitigation-planning.htm
13. https://doc.arcgis.com/en/arcgis-solutions/latest/reference/configure-hazard-mitigation-planning.htm
14. https://doc.arcgis.com/en/arcgis-solutions/latest/reference/introduction-to-emergency-debris-management.htm
15. https://doc.arcgis.com/en/arcgis-solutions/latest/reference/introduction-to-watch-center.htm
16. https://doc.arcgis.com/en/arcgis-solutions/latest/reference/introduction-to-wildfire-protection-planning.htm
17. https://doc.arcgis.com/en/arcgis-solutions/latest/reference/introduction-to-flood-impact-analysis.htm
18. https://doc.arcgis.com/en/arcgis-solutions/latest/reference/introduction-to-road-closures.htm
19. https://www.esri.com/en-us/c/industry/public-safety/emergency-management-operations-solution
20. https://www.esri.com/en-us/disaster-response/overview
21. https://www.arcgis.com/apps/solutions/index.html?gallery=true&domain=Emergency+Management&industry=Public+Safety

Esri solution templates (public ArcGIS Online items; web map and service JSON read from `https://www.arcgis.com/sharing/rest/content/items/<id>/data?f=json`; catalog from `https://www.arcgis.com/sharing/rest/search?q=owner:arcgis_solutions AND type:Solution`)
22. Emergency Management Operations: https://www.arcgis.com/home/item.html?id=45de5780c57f4672830a2dd9abe4ffb3
23. Damage Assessment: https://www.arcgis.com/home/item.html?id=989dd829ba6f44d59c2a66b4f838c169
24. Emergency Shelter Management: https://www.arcgis.com/home/item.html?id=9ab7c15708d5404dace6b04127cd4d53
25. Hazard Mitigation Planning: https://www.arcgis.com/home/item.html?id=d34c6650e3da4672ae4f0f18d93323cf
26. Emergency Debris Management: https://www.arcgis.com/home/item.html?id=545ac081cbd54de291d3d193f76e5b91
27. Know Your Zone: https://www.arcgis.com/home/item.html?id=3ea4387dce19409b8286b1e515e14530
28. Watch Center: https://www.arcgis.com/home/item.html?id=191c0464030f482c9b9369786d9048ce
29. Incident Awareness and Assessment: https://www.arcgis.com/home/item.html?id=3e417820296b4ff7be42fa4f6e8d2177
30. Civil Support: https://www.arcgis.com/home/item.html?id=8caa4ebb680648c39e4c7d2dbcf5867f
31. Special Event Operations: https://www.arcgis.com/home/item.html?id=ba68351201b2474db3db533414be712b
32. Wildfire Protection Planning: https://www.arcgis.com/home/item.html?id=79196d118958485596ee1f78e475dd05
33. Community Risk Reduction: https://www.arcgis.com/home/item.html?id=9e2c6967a0404fc69ef7380e4ec3961f
34. Pre-Incident Planning: https://www.arcgis.com/home/item.html?id=a9d778129d324d869e0280593222031b
35. Road Closures: https://www.arcgis.com/home/item.html?id=20e7798b488d4139b79d4238d3e35075
36. Shelter Locator 1.0 (mature support): https://www.arcgis.com/home/item.html?id=28cd55ddf9ec493fa9410569dd11dab4
37. Community Data Aggregation: https://www.arcgis.com/home/item.html?id=6c14f8abf7ae49d192a156f33be45b96
38. Rapid Needs Assessment: https://www.arcgis.com/home/item.html?id=4f24cd9b79ed435c8747b56c81d30cc7

Esri platform documentation
39. https://doc.arcgis.com/en/arcgis-online/get-started/view-legend-mv.htm
40. https://developers.arcgis.com/javascript/latest/api-reference/esri-widgets-LayerList.html
41. https://doc.arcgis.com/en/experience-builder/latest/configure-widgets/widgets-overview.htm
42. https://doc.arcgis.com/en/instant-apps/latest/create-apps/pdf/arcgis-instant-apps-matrix.pdf
43. https://doc.arcgis.com/en/dashboards/latest/create-and-share/configuring-actions-on-dashboard-elements.htm
44. https://doc.arcgis.com/en/dashboards/latest/create-and-share/charts-as-source-of-actions.htm
45. https://www.esri.com/content/dam/esrisites/en-us/media/legal/product-specific-terms-of-use/e300.pdf

Living Atlas and federal data
46. USA Structures item: https://www.arcgis.com/home/item.html?id=0ec8512ad21e4bb987d7e848d14e7e24
47. USA Structures service: https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/USA_Structures_View/FeatureServer/0
48. USA Structures paper: https://www.nature.com/articles/s41597-024-03219-x
49. FEMA USA Structures: https://gis-fema.hub.arcgis.com/datasets/fedmaps::usa-structures/about
50. Microsoft US Building Footprints: https://github.com/microsoft/USBuildingFootprints
51. Microsoft Building Footprints tiles item: https://www.arcgis.com/home/item.html?id=f40326b0dea54330ae39584012807126
52. Overture attribution and licensing: https://docs.overturemaps.org/attribution/
53. Regrid parcels item: https://www.arcgis.com/home/item.html?id=a2050b09baff493aa4ad7848ba2fac00
54. AIANNH item: https://www.arcgis.com/home/item.html?id=70c973c7e48949f9845e320f3b79a1d7
55. BIA LAR item: https://www.arcgis.com/home/item.html?id=e21128c26386412ca682accf7a57361a
56. BIA LAR MapServer: https://biamaps.geoplatform.gov/server/rest/services/DivLTR/BIA_AIAN_National_LAR/MapServer/0
57. BIA LAR on data.gov: https://catalog.data.gov/dataset/bia-aian-land-area-representations-map
58. USA Weather Watches and Warnings item: https://www.arcgis.com/home/item.html?id=a6134ae01aad44c499d12feec782b386
59. USA Current Wildfires item: https://www.arcgis.com/home/item.html?id=d957997ccee7408287a963600a77f61f
60. Active Hurricanes item: https://www.arcgis.com/home/item.html?id=248e7b5827a34b248647afb012c58787
61. Current Weather and Wind Station Data item: https://www.arcgis.com/home/item.html?id=cb1886ff0a9d4156ba4d2fadd7e8a139
62. USA Storm Reports item: https://www.arcgis.com/home/item.html?id=e109e8fd9c5a495c813b5cbaee9c7d9b
63. U.S. National Grid item: https://www.arcgis.com/home/item.html?id=d96095fb637846889fb0e46ce69e3967
64. National Risk Index tracts item: https://www.arcgis.com/home/item.html?id=9da4eeb936544335a6db0cd7a8448a51
65. National Risk Index counties item: https://www.arcgis.com/home/item.html?id=39485e8035d446a5bff03259508ae355
66. CDC/ATSDR SVI 2022 item: https://www.arcgis.com/home/item.html?id=414c0b43a0ec4adc829d5815bc621750
67. USGS seismic service (shake intensity renderer): https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/USGS_Seismic_Data_v1/FeatureServer/1
68. NWS watches and warnings service (renderer): https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/NWS_Watches_Warnings_v1/FeatureServer/6
69. Wildfire perimeters service (renderer): https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/USA_Wildfires_v1/FeatureServer/1
70. Live stream gauges service (renderer): https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/Live_Stream_Gauges_v1/FeatureServer/0
71. NFHL reduced set service (renderer): https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Flood_Hazard_Reduced_Set_gdb/FeatureServer/0
72. Hurricane evacuation routes service (renderer): https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/Hurricane_Evacuation_Routes_1/FeatureServer/0
73. NIFC WFIGS current perimeters: https://data-nifc.opendata.arcgis.com/datasets/nifc::wfigs-current-interagency-fire-perimeters/about
74. NWS hazard map colors: https://www.weather.gov/help-map
75. CISA critical infrastructure sectors: https://www.cisa.gov/topics/critical-infrastructure-security-and-resilience/critical-infrastructure-sectors
76. HIFLD Open shutdown: https://atcoordinates.info/2025/08/08/hifld-open-gis-portal-shuts-down-aug-26-2025/
77. HSDL HIFLD archive: https://www.hsdl.org/hifld/
78. HIFLD crosswalk (DataLumos): https://www.datalumos.org/datalumos/project/241367/version/V1/view

FEMA and NAPSG
79. FEMA Community Lifelines: https://www.fema.gov/emergency-managers/practitioners/lifelines
80. FEMA Lifelines Toolkit page: https://www.fema.gov/emergency-managers/practitioners/lifelines-toolkit
81. FEMA Lifelines Toolkit v2.1: https://www.fema.gov/sites/default/files/documents/fema_lifelines-toolkit-v2.1_2023.pdf
82. FEMA PDA Guide 2021: https://www.fema.gov/sites/default/files/documents/fema_2021-pda-guide.pdf
83. FEMA PDA Guide 07/2025: https://www.fema.gov/sites/default/files/documents/fema_rd_pda-guide_07012025.pdf
84. NAPSG symbol library page (license): https://www.napsgfoundation.org/all-resources/symbology-library/
85. NAPSG symbol library tool: https://napsg-web.s3.amazonaws.com/symbology/index.html
86. NAPSG symbol manifest v4.1.5: https://napsg-web.s3.amazonaws.com/symbology/napsg_symbology_v4.1.5.json
87. NAPSG Situational Awareness Web Map: https://www.arcgis.com/home/item.html?id=8f16acb5bddd4045a6d518e80bcaf9da
88. NAPSG Symbols Library item: https://www.arcgis.com/home/item.html?id=c2b91ca8527c403fb546d73607fc02fd
89. NAPSG community lifeline symbols announcement: https://www.napsgfoundation.org/community-lifeline-symbols-and-symbol-library-tool-updates/

Juvare WebEOC
90. https://docs.juvare.com/webeoc-onnexa/board-list/board-list.htm
91. https://confluence.juvare.com/display/PKC/Standard+WebEOC+Boards
92. https://docs.juvare.com/webeoc-onnexa/board-list/board-after-action-review.htm
93. https://docs.juvare.com/webeoc-onnexa/board-list/board-after-action-review-release-notes.htm
94. https://docs.juvare.com/webeoc-onnexa/board-list/set-up-after-action-review-ds-board.htm
95. https://docs.juvare.com/webeoc-onnexa/board-list/board-checklist.htm
96. https://docs.juvare.com/webeoc-onnexa/board-list/board-checklist-release-notes.htm
97. https://docs.juvare.com/webeoc-onnexa/board-list/checklist-user-guide/checklist-user-guide-overview.htm
98. https://docs.juvare.com/webeoc-onnexa/board-list/board-incident-action-plan.htm
99. https://docs.juvare.com/webeoc-onnexa/board-list/board-incident-action-plan-release-notes.htm
100. https://docs.juvare.com/webeoc-onnexa/board-list/iap-user-guide/iap-user-guide-overview.htm
101. https://docs.juvare.com/webeoc-onnexa/board-list/board-requests-tasks.htm
102. https://docs.juvare.com/webeoc-onnexa/help/dashboards/about-dashboards.htm
103. https://docs.juvare.com/webeoc-onnexa/help/mapping/about-mapping.htm
104. https://docs.juvare.com/webeoc-onnexu/help/mapping/maps/about-maps.htm
105. https://docs.juvare.com/webeoc-onnexa/help/mapping/mapping-manager/about-mapping-manager.htm
106. https://docs.juvare.com/webeoc-onnexa/help/mapping/mapping-manager/create-map.htm
107. https://docs.juvare.com/webeoc-onnexa/help/mapping/mapping-manager/create-map-layer.htm
108. https://docs.juvare.com/webeoc-onnexa/help/mapping/mapping-manager/view-data-on-timeline-on-maps.htm
109. https://www.juvare.com/product-add-ons/arcgis/
110. https://www.juvare.com/products/boards/add-on/arcgis-extension-for-webeoc/
111. https://www.esri.com/partners/juvare-a2T70000000TNQCEA4/webeoc-mapper-profes-a2d700000013cCoAAI
112. https://www.securityinfowatch.com/home/article/10557858/webeoc-mapper-provides-the-power-of-gis-for-optimized-situational-awareness-decision-support-and-much-more
113. Screenshots read from Juvare docs: https://docs.juvare.com/webeoc-onnexa/Resources/Images/LightModeBoards/ (AAR, Checklists, IAP, Requests Tasks dashboards) and https://docs.juvare.com/webeoc-onnexa/Resources/Images/checklist-user-guide/ (DashboardTab, MyChecklistsTab)

Veoci
114. https://veoci.com/government/situational-awareness/
115. https://veoci.com/emergency-management/resource-asset-management/
116. https://veoci.com/downloadable/integrations/
117. https://veoci.com/partners/esri/ (HTTP 404 on 2026-09-26)
118. https://www.stamfordgis.org/public/rest/services/Veoci/MapServer
119. https://www.arcgis.com/home/item.html?id=a7f158e0cda043c08163d997b32dc895
120. https://www.arcgis.com/home/item.html?id=857772f2edd04760b0aa9127d3223ecf
121. Repository: docs/process/VEOCI-PLATFORM-RESEARCH-2026-09-24.md

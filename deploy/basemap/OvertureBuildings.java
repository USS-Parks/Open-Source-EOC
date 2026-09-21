package org.openeoc.basemap;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.onthegomap.planetiler.FeatureCollector;
import com.onthegomap.planetiler.Planetiler;
import com.onthegomap.planetiler.Profile;
import com.onthegomap.planetiler.config.Arguments;
import com.onthegomap.planetiler.reader.SourceFeature;
import com.onthegomap.planetiler.reader.osm.OsmElement;
import com.onthegomap.planetiler.reader.osm.OsmSourceFeature;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.LongAdder;

/**
 * Builds the COP building archive from OSM geometry and an exact Overture-to-OSM lookup.
 * Overture never supplies geometry, and only current building=yes ways can be enriched.
 */
public final class OvertureBuildings implements Profile {
  private static final String RELEASE = "2026-08-19.0";
  private static final String OSM_ATTRIBUTION_HTML =
      "<a href=\"https://www.openstreetmap.org/copyright\" target=\"_blank\">&copy; OpenStreetMap contributors</a>";
  private static final String OVERTURE_ATTRIBUTION_HTML =
      "<a href=\"https://overturemaps.org/\" target=\"_blank\">Overture Maps Foundation</a>";

  private record Enrichment(String use, String subtype, String overtureId) {}

  private final Map<Long, Enrichment> lookup;
  private final Set<Long> lookupIdsSeen = ConcurrentHashMap.newKeySet();
  private final LongAdder buildingFeatures = new LongAdder();
  private final LongAdder wayBuildings = new LongAdder();
  private final LongAdder relationBuildings = new LongAdder();
  private final LongAdder typedOsm = new LongAdder();
  private final LongAdder untypedOsm = new LongAdder();
  private final LongAdder applied = new LongAdder();
  private final LongAdder typedOsmWins = new LongAdder();

  private OvertureBuildings(Map<Long, Enrichment> lookup) {
    this.lookup = Map.copyOf(lookup);
  }

  private static Map<Long, Enrichment> readLookup(Path path) throws IOException {
    Map<Long, Enrichment> result = new LinkedHashMap<>();
    try (BufferedReader reader = Files.newBufferedReader(path)) {
      String header = reader.readLine();
      if (!"osm_id\tuse\tsubtype\toverture_id".equals(header)) {
        throw new IllegalArgumentException("Unexpected lookup header: " + header);
      }
      String line;
      while ((line = reader.readLine()) != null) {
        String[] columns = line.split("\t", -1);
        if (columns.length != 4) {
          throw new IllegalArgumentException("Malformed lookup row: " + line);
        }
        long osmId = Long.parseUnsignedLong(columns[0]);
        Enrichment previous = result.put(
            osmId, new Enrichment(columns[1], columns[2], columns[3]));
        if (previous != null) {
          throw new IllegalArgumentException("Duplicate OSM way ID in lookup: " + columns[0]);
        }
      }
    }
    return result;
  }

  @Override
  public void processFeature(SourceFeature source, FeatureCollector features) {
    if (!source.canBePolygon() || !source.hasTag("building") || source.hasTag("building", "no")) {
      return;
    }
    if (!(source instanceof OsmSourceFeature osmFeature)) {
      return;
    }

    OsmElement element = osmFeature.originalElement();
    long osmId = element.id();
    String buildingClass = source.getString("building");
    buildingFeatures.increment();
    if (element instanceof OsmElement.Way) {
      wayBuildings.increment();
    } else if (element instanceof OsmElement.Relation) {
      relationBuildings.increment();
    }

    FeatureCollector.Feature output = features.polygon("buildings")
        .setMinZoom(13)
        .setAttr("class", buildingClass)
        .setAttr("osm_id", osmId);
    String name = source.getString("name");
    if (name != null && !name.isBlank()) {
      output.setAttrWithMinzoom("name", name, 15);
    }
    Integer levels = integerTag(source.getTag("building:levels"));
    if (levels != null) {
      output.setAttrWithMinzoom("levels", levels, 15);
    }

    Enrichment enrichment = element instanceof OsmElement.Way ? lookup.get(osmId) : null;
    if (enrichment != null) {
      lookupIdsSeen.add(osmId);
      if ("yes".equals(buildingClass)) {
        untypedOsm.increment();
        applied.increment();
        output
            .setAttr("overture_use", enrichment.use())
            .setAttr("overture_subtype", enrichment.subtype())
            .setAttr("overture_id", enrichment.overtureId())
            .setAttr("overture_release", RELEASE);
      } else {
        typedOsm.increment();
        typedOsmWins.increment();
      }
    } else if ("yes".equals(buildingClass)) {
      untypedOsm.increment();
    } else {
      typedOsm.increment();
    }
  }

  private static Integer integerTag(Object value) {
    if (value instanceof Number number) {
      return number.intValue();
    }
    if (value instanceof String string && string.matches("[0-9]+")) {
      try {
        return Integer.valueOf(string);
      } catch (NumberFormatException ignored) {
        return null;
      }
    }
    return null;
  }

  @Override
  public String name() {
    return "Open Source EOC OSM buildings with Overture subtype enrichment";
  }

  @Override
  public String description() {
    return "OSM building footprints; exact OSM-way matches enrich current building=yes features";
  }

  @Override
  public String attribution() {
    return OSM_ATTRIBUTION_HTML + "; enrichment: " + OVERTURE_ATTRIBUTION_HTML;
  }

  @Override
  public String version() {
    return "h14-" + RELEASE;
  }

  @Override
  public Map<String, String> extraArchiveMetadata() {
    return Map.of(
        "overture_release", RELEASE,
        "overture_join", "exact root OpenStreetMap way identity; current building=yes only",
        "overture_geometry", "not used; footprints remain from the OSM PBF",
        "overture_license", "ODbL-1.0");
  }

  private Map<String, Object> counts() {
    Map<String, Object> result = new LinkedHashMap<>();
    result.put("lookup_rows", lookup.size());
    result.put("lookup_ids_seen_in_current_pbf", lookupIdsSeen.size());
    result.put("lookup_ids_not_seen_in_current_pbf", lookup.size() - lookupIdsSeen.size());
    result.put("building_features", buildingFeatures.sum());
    result.put("way_buildings", wayBuildings.sum());
    result.put("relation_buildings", relationBuildings.sum());
    result.put("typed_osm_features", typedOsm.sum());
    result.put("untyped_osm_features", untypedOsm.sum());
    result.put("overture_enriched_features", applied.sum());
    result.put("current_typed_osm_wins", typedOsmWins.sum());
    result.put("duplicate_overture_footprints_emitted", 0);
    return result;
  }

  private static String sha256(Path path) throws IOException, NoSuchAlgorithmException {
    MessageDigest digest = MessageDigest.getInstance("SHA-256");
    byte[] buffer = new byte[8 * 1024 * 1024];
    try (InputStream input = Files.newInputStream(path)) {
      int read;
      while ((read = input.read(buffer)) >= 0) {
        if (read > 0) {
          digest.update(buffer, 0, read);
        }
      }
    }
    return java.util.HexFormat.of().formatHex(digest.digest());
  }

  private static void writeBuildManifest(
      Path manifestPath,
      Path osmPath,
      Path lookupPath,
      Path outputPath,
      OvertureBuildings profile) throws Exception {
    Map<String, Object> manifest = new LinkedHashMap<>();
    manifest.put("format", "openeoc-h14-build-v1");
    manifest.put("overture_release", RELEASE);
    manifest.put("geometry_authority", "OpenStreetMap PBF");
    manifest.put("identity", "osm_id from current OSM way/relation; Overture lookup accepts ways only");
    manifest.put("osm_path", osmPath.toAbsolutePath().toString());
    manifest.put("osm_bytes", Files.size(osmPath));
    manifest.put("osm_sha256", sha256(osmPath));
    manifest.put("lookup_path", lookupPath.toAbsolutePath().toString());
    manifest.put("lookup_sha256", sha256(lookupPath));
    manifest.put("archive", outputPath.toAbsolutePath().toString());
    manifest.put("archive_bytes", Files.size(outputPath));
    manifest.put("archive_sha256", sha256(outputPath));
    manifest.put("counts", profile.counts());
    ObjectMapper mapper = new ObjectMapper().enable(SerializationFeature.INDENT_OUTPUT);
    Path pending = manifestPath.resolveSibling(manifestPath.getFileName() + ".pending");
    mapper.writeValue(pending.toFile(), manifest);
    Files.move(
        pending,
        manifestPath,
        java.nio.file.StandardCopyOption.REPLACE_EXISTING,
        java.nio.file.StandardCopyOption.ATOMIC_MOVE);
  }

  public static void main(String[] args) throws Exception {
    if (args.length < 5) {
      throw new IllegalArgumentException(
          "Usage: OvertureBuildings <osm.pbf> <lookup.tsv> <output.pmtiles> <tmpdir> <manifest.json> [planetiler args]");
    }
    Path osmPath = Path.of(args[0]);
    Path lookupPath = Path.of(args[1]);
    Path outputPath = Path.of(args[2]);
    Path tmpPath = Path.of(args[3]);
    Path manifestPath = Path.of(args[4]);
    Files.createDirectories(outputPath.toAbsolutePath().getParent());
    Files.createDirectories(tmpPath);
    OvertureBuildings profile = new OvertureBuildings(readLookup(lookupPath));
    String[] forwarded = Arrays.copyOfRange(args, 5, args.length);
    Arguments arguments = Arguments.fromArgs(forwarded)
        .withDefault("threads", 2)
        .withDefault("write_threads", 1)
        .withDefault("process_threads", 2)
        .withDefault("tmpdir", tmpPath.toString())
        .withDefault("maxzoom", 14)
        .withDefault("render_maxzoom", 14);
    Planetiler.create(arguments)
        .setProfile(profile)
        .addOsmSource("osm", osmPath)
        .overwriteOutput(outputPath)
        .run();
    writeBuildManifest(manifestPath, osmPath, lookupPath, outputPath, profile);
  }
}

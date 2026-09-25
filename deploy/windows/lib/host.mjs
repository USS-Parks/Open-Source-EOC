import { win32 } from "node:path";

/**
 * The network host: one Windows computer serves Open Source EOC to the other
 * computers on its network. PostgreSQL, the server (with its outbox worker and
 * scheduler) and Caddy run as services under the LocalService account; Caddy
 * terminates HTTPS with a certificate authority it creates on the host and
 * forwards to the server on the loopback address. Everything here renders the
 * definitions as text; desktop.mjs installs them.
 */

export const HOST_PROFILES = Object.freeze(["host", "host-demo"]);
export const SERVICES = Object.freeze({
  postgres: "OpenSourceEOC-PostgreSQL",
  server: "OpenSourceEOC-Server",
  caddy: "OpenSourceEOC-Caddy",
});
export const FIREWALL_RULE = "OpenSourceEOC-Host";
export const BACKUP_TASK = "\\Open Source EOC\\Host backup";
export const TRUST_PATH = "/trust/openeoc-root.crt";

// Well-known SIDs, so the grants do not depend on the Windows display language.
export const SID = Object.freeze({ system: "S-1-5-18", localService: "S-1-5-19", administrators: "S-1-5-32-544" });

export function isHostProfile(profile) {
  return HOST_PROFILES.includes(profile);
}

export function hostPaths(dataRoot) {
  const root = win32.join(dataRoot, "host");
  const caddyStorage = win32.join(root, "caddy");
  return Object.freeze({
    root,
    config: win32.join(root, "host.json"),
    caddyfile: win32.join(root, "Caddyfile"),
    caddyStorage,
    rootCertificate: win32.join(caddyStorage, "pki", "authorities", "local", "root.crt"),
    intermediateCertificate: win32.join(caddyStorage, "pki", "authorities", "local", "intermediate.crt"),
    services: win32.join(root, "services"),
    backupTask: win32.join(root, "services", "backup-task.xml"),
  });
}

const DNS_NAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;
const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

/**
 * The names other computers reach the host by: its computer name, its DNS
 * name, any names the agency adds, and its IPv4 addresses, then the loopback
 * names. Link-local addresses are left out; they change on every start. A
 * computer name that is not a valid DNS name (an underscore, say) is skipped;
 * a name the agency adds must be valid.
 */
export function hostNames({ hostname, fqdn = "", interfaces = {}, extra = [] }) {
  const names = [];
  const add = (value, source, strict = true) => {
    const name = String(value ?? "").trim().toLowerCase().replace(/\.$/, "");
    if (name === "") return;
    if (!DNS_NAME.test(name) && !IPV4.test(name)) {
      if (!strict) return;
      throw new Error(`${source} is not a host name or IPv4 address: ${value}`);
    }
    if (!names.includes(name)) names.push(name);
  };
  add(hostname, "The computer name", false);
  add(fqdn, "The computer's DNS name", false);
  for (const name of extra) add(name, "A host name");
  for (const addresses of Object.values(interfaces))
    for (const address of addresses ?? [])
      if (address.family === "IPv4" && !address.internal && !address.address.startsWith("169.254.")) add(address.address, "An address");
  add("localhost", "localhost");
  add("127.0.0.1", "The loopback address");
  return names;
}

function caddyString(value) {
  const text = String(value).replaceAll("\\", "/");
  if (/["\r\n{}]/.test(text)) throw new Error(`Caddyfile value cannot contain quotes, braces or line breaks: ${text}`);
  return `"${text}"`;
}

/**
 * The Caddyfile. HTTPS on every host name with the host's own certificate
 * authority (or the agency's certificate), plain HTTP only to redirect, the
 * authority's root certificate at TRUST_PATH so a browser can be told to trust
 * it, and everything else to the server on the loopback address. The admin
 * endpoint is off and nothing is installed into the host's trust store.
 */
export function caddyfile({ names, upstreamPort, storage, logFile, caName, httpsPort = 443, httpPort = 80, bind = null, certificate = null }) {
  if (names.length === 0) throw new Error("The host needs at least one name");
  const port = httpsPort === 443 ? "" : `:${httpsPort}`;
  const tls = certificate
    ? `tls ${caddyString(certificate.cert)} ${caddyString(certificate.key)}`
    : "tls internal";
  const trust = certificate ? "" : [
    `\thandle ${TRUST_PATH} {`,
    "\t\theader Content-Type application/x-x509-ca-cert",
    '\t\theader Content-Disposition "attachment; filename=open-source-eoc-root.crt"',
    "\t\trewrite * /pki/authorities/local/root.crt",
    `\t\troot * ${caddyString(storage)}`,
    "\t\tfile_server",
    "\t}",
  ].join("\n") + "\n";
  return [
    "# Written by the Open Source EOC host setup, which replaces it on every run.",
    "{",
    "\tadmin off",
    "\tpersist_config off",
    "\tskip_install_trust",
    `\thttp_port ${httpPort}`,
    `\thttps_port ${httpsPort}`,
    ...(bind ? [`\tdefault_bind ${bind}`] : []),
    "\tstorage file_system {",
    `\t\troot ${caddyString(storage)}`,
    "\t}",
    "\tpki {",
    "\t\tca local {",
    `\t\t\tname ${caddyString(caName)}`,
    `\t\t\troot_cn ${caddyString(`${caName} Root`)}`,
    `\t\t\tintermediate_cn ${caddyString(`${caName} Intermediate`)}`,
    "\t\t}",
    "\t}",
    "\tlog {",
    `\t\toutput file ${caddyString(logFile)} {`,
    "\t\t\troll_size 10MiB",
    "\t\t\troll_keep 5",
    "\t\t}",
    "\t}",
    "}",
    "",
    `${names.map((name) => `https://${name}${port}`).join(", ")} {`,
    `\t${tls}`,
    trust + "\thandle {",
    `\t\treverse_proxy 127.0.0.1:${upstreamPort}`,
    "\t}",
    "}",
    "",
  ].join("\n");
}

function xml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/** One Windows command line from arguments, quoting those with spaces. */
export function commandLine(args) {
  return args.map((arg) => {
    const text = String(arg);
    if (text.includes('"')) throw new Error(`An argument cannot contain a quote: ${text}`);
    return /\s/.test(text) || text === "" ? `"${text}"` : text;
  }).join(" ");
}

/** A WinSW 2 service definition that runs as LocalService and restarts after a failure. */
export function winswService({ id, name, description, executable, args, workingDirectory, env = {}, depend = [], logPath }) {
  return [
    "<service>",
    `  <id>${xml(id)}</id>`,
    `  <name>${xml(name)}</name>`,
    `  <description>${xml(description)}</description>`,
    `  <executable>${xml(executable)}</executable>`,
    `  <arguments>${xml(commandLine(args))}</arguments>`,
    `  <workingdirectory>${xml(workingDirectory)}</workingdirectory>`,
    ...Object.entries(env).map(([key, value]) => `  <env name="${xml(key)}" value="${xml(value)}" />`),
    ...depend.map((service) => `  <depend>${xml(service)}</depend>`),
    "  <startmode>Automatic</startmode>",
    '  <onfailure action="restart" delay="10 sec" />',
    '  <onfailure action="restart" delay="30 sec" />',
    "  <resetfailure>1 hour</resetfailure>",
    "  <stoptimeout>30 sec</stoptimeout>",
    `  <logpath>${xml(logPath)}</logpath>`,
    '  <log mode="roll-by-size">',
    "    <sizeThreshold>10240</sizeThreshold>",
    "    <keepFiles>8</keepFiles>",
    "  </log>",
    "  <serviceaccount>",
    "    <domain>NT AUTHORITY</domain>",
    "    <user>LocalService</user>",
    "  </serviceaccount>",
    "</service>",
    "",
  ].join("\n");
}

/** Read back what a WinSW definition runs, as WinSW would: the proof starts the same process. */
export function parseWinswService(text) {
  const unxml = (value) => value.replaceAll("&quot;", '"').replaceAll("&gt;", ">").replaceAll("&lt;", "<").replaceAll("&amp;", "&");
  const one = (tag) => unxml(new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(text)?.[1] ?? "");
  const env = {};
  for (const match of text.matchAll(/<env name="([^"]*)" value="([^"]*)" \/>/g)) env[unxml(match[1])] = unxml(match[2]);
  return { id: one("id"), executable: one("executable"), arguments: one("arguments"), workingDirectory: one("workingdirectory"), env };
}

/**
 * The daily backup as a Task Scheduler definition, run as LocalService. The
 * launcher's Backup action dumps the database and copies the file store into
 * the profile's backups folder and removes its own backups past 14 days.
 */
export function backupTaskXml({ powershell, launcher, profile, workingDirectory, at = "02:30" }) {
  if (!/^\d{2}:\d{2}$/.test(at)) throw new Error(`The backup time must be HH:MM: ${at}`);
  const args = commandLine(["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", launcher, "-Action", "Backup", "-Profile", profile]);
  return [
    '<?xml version="1.0" encoding="UTF-16"?>',
    '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">',
    "  <RegistrationInfo>",
    "    <Description>Daily backup of the Open Source EOC host's database and file store.</Description>",
    "  </RegistrationInfo>",
    "  <Triggers>",
    "    <CalendarTrigger>",
    `      <StartBoundary>2026-01-01T${at}:00</StartBoundary>`,
    "      <ScheduleByDay>",
    "        <DaysInterval>1</DaysInterval>",
    "      </ScheduleByDay>",
    "    </CalendarTrigger>",
    "  </Triggers>",
    "  <Principals>",
    '    <Principal id="Author">',
    `      <UserId>${SID.localService}</UserId>`,
    "      <RunLevel>LeastPrivilege</RunLevel>",
    "    </Principal>",
    "  </Principals>",
    "  <Settings>",
    "    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>",
    "    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>",
    "    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>",
    "    <StartWhenAvailable>true</StartWhenAvailable>",
    "    <ExecutionTimeLimit>PT2H</ExecutionTimeLimit>",
    "    <Enabled>true</Enabled>",
    "  </Settings>",
    '  <Actions Context="Author">',
    "    <Exec>",
    `      <Command>${xml(powershell)}</Command>`,
    `      <Arguments>${xml(args)}</Arguments>`,
    `      <WorkingDirectory>${xml(workingDirectory)}</WorkingDirectory>`,
    "    </Exec>",
    "  </Actions>",
    "</Task>",
    "",
  ].join("\r\n");
}

function psString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

/** Inbound HTTPS, and HTTP for the redirect, to Caddy alone, on every network profile. */
export function firewallCommands({ caddyExecutable, ports = [80, 443] }) {
  return {
    add: `New-NetFirewallRule -Name ${psString(FIREWALL_RULE)} -DisplayName ${psString("Open Source EOC host (HTTPS)")} `
      + `-Description ${psString("Lets other computers on the network reach Open Source EOC on this host.")} `
      + `-Direction Inbound -Action Allow -Protocol TCP -LocalPort ${ports.join(",")} -Program ${psString(caddyExecutable)} -Profile Any | Out-Null`,
    remove: `Get-NetFirewallRule -Name ${psString(FIREWALL_RULE)} -ErrorAction SilentlyContinue | Remove-NetFirewallRule`,
  };
}

/** PostgreSQL's service registration; the port and logging are in its settings file. */
export function postgresRegisterArgs({ pgData }) {
  return ["register", "-N", SERVICES.postgres, "-U", "NT AUTHORITY\\LocalService", "-D", pgData, "-S", "auto", "-w", "-t", "120"];
}

/** Settings the host's PostgreSQL reads through an include line in postgresql.conf. */
export function postgresSettings({ pgPort, logDirectory }) {
  return [
    "# Written by the Open Source EOC host setup, which replaces it on every run.",
    "listen_addresses = '127.0.0.1'",
    `port = ${pgPort}`,
    "logging_collector = on",
    `log_directory = '${String(logDirectory).replaceAll("\\", "/").replaceAll("'", "''")}'`,
    "log_filename = 'postgres-%a.log'",
    "log_truncate_on_rotation = on",
    "log_rotation_age = 1d",
    "log_rotation_size = 0",
    "",
  ].join("\n");
}

export const POSTGRES_INCLUDE = "include_if_exists = 'openeoc-host.conf'";

/**
 * Every definition the host needs, from the installed layout. The proof calls
 * this with a temporary data root, loopback-only binding and spare ports.
 */
export function hostDefinitions({
  appRoot, dataRoot, profile, profileRoot, pgData, pgPort, httpPort, names,
  nodeExecutable, caddyExecutable, distRoot, publicRoot, pgDist,
  certificate = null, httpsPort = 443, redirectPort = 80, bind = null, powershell,
}) {
  if (!isHostProfile(profile)) throw new Error(`Not a host profile: ${profile}`);
  const host = hostPaths(dataRoot);
  const logs = win32.join(profileRoot, "logs");
  const publicUrl = `https://${names[0]}${httpsPort === 443 ? "" : `:${httpsPort}`}`;
  const server = winswService({
    id: SERVICES.server,
    name: "Open Source EOC server",
    description: "Open Source EOC for the network, with its delivery queue and scheduler. Reached through Open Source EOC HTTPS.",
    executable: nodeExecutable,
    args: [win32.join(appRoot, "deploy", "windows", "desktop.mjs"), "host-serve", `--profile=${profile}`],
    workingDirectory: appRoot,
    env: {
      OPENEOC_DESKTOP_PREBUILT: "1",
      OPENEOC_DESKTOP_DATA_ROOT: dataRoot,
      OPENEOC_DESKTOP_DIST_ROOT: distRoot,
      OPENEOC_DESKTOP_PUBLIC_ROOT: publicRoot,
      OPENEOC_PG_DIST: pgDist,
      // Caddy is the only client of the loopback port; the limiters key on the browser's address it forwards.
      OPENEOC_TRUST_PROXY: "127.0.0.1",
      OPENEOC_PUBLIC_URL: publicUrl,
      ...(certificate ? {} : { OPENEOC_TRUST_CERTIFICATE_URL: TRUST_PATH }),
    },
    depend: [SERVICES.postgres],
    logPath: logs,
  });
  const caddy = winswService({
    id: SERVICES.caddy,
    name: "Open Source EOC HTTPS",
    description: "HTTPS for Open Source EOC on the network, with this host's own certificate authority.",
    executable: caddyExecutable,
    args: ["run", "--config", host.caddyfile, "--adapter", "caddyfile"],
    workingDirectory: host.root,
    env: { XDG_DATA_HOME: host.caddyStorage, XDG_CONFIG_HOME: host.caddyStorage },
    logPath: logs,
  });
  return {
    names,
    publicUrl,
    caddyfile: caddyfile({
      names,
      upstreamPort: httpPort,
      storage: host.caddyStorage,
      logFile: win32.join(logs, "caddy.log"),
      caName: `Open Source EOC ${names[0]}`,
      httpsPort,
      httpPort: redirectPort,
      bind,
      certificate,
    }),
    services: { server, caddy },
    backupTask: backupTaskXml({
      powershell,
      launcher: win32.join(appRoot, "deploy", "windows", "Open-Source-EOC.ps1"),
      profile,
      workingDirectory: appRoot,
    }),
    firewall: firewallCommands({ caddyExecutable, ports: [redirectPort, httpsPort] }),
    postgresRegister: postgresRegisterArgs({ pgData }),
    postgresSettings: postgresSettings({ pgPort, logDirectory: logs }),
  };
}

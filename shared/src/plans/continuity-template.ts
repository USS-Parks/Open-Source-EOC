import type { PlanDefinitionInput } from "./contract.js";

/**
 * A continuity plan to start from (VC-19): the essential functions, recovery
 * locations, orders of succession and delegations a small tribal or rural
 * government commonly needs, written to be edited into the jurisdiction's
 * own. It activates the standard Continuity of Operations incident template
 * and names no place, person or scenario.
 */
export const CONTINUITY_PLAN_TEMPLATE: { readonly title: string; readonly definition: PlanDefinitionInput } = {
  title: "Continuity of Operations Plan",
  definition: {
    kind: "continuity",
    templateKey: "continuity_of_operations",
    incidentKind: "incident",
    reviewEveryDays: 365,
    sections: [
      {
        title: "Purpose and when this plan applies",
        body: "This plan keeps the government's essential functions running when its offices, staff, systems or communications are lost or cannot be reached: a fire, flood or earthquake at the offices, a long power or network outage, an illness that keeps many staff home, or an evacuation. It is activated by the emergency manager or the first successor available, and it applies to every department that performs an essential function.",
      },
      {
        title: "Concept of operations",
        body: "Phase 1, activation and relocation (first 12 hours): confirm who holds authority, tell staff where to report, move to the recovery location and restore the functions with the shortest recovery times first.\nPhase 2, alternate operations: perform the essential functions from the recovery location with the vital records and resources listed for each, and report their status to the EOC every operational period.\nPhase 3, reconstitution: return to the primary offices or a permanent replacement, bring back the functions that were suspended, and record lessons for the after-action review.",
        positions: ["incident_commander", "logistics_section_chief"],
      },
      {
        title: "Orders of succession and delegations of authority",
        body: "Succession and delegations take effect only as written below and end when the holder returns or the governing body says so. Every action taken under a delegation is recorded in the activity log with who took it.",
        positions: ["incident_commander"],
        boards: ["activity_log"],
      },
      {
        title: "Vital records and communications",
        body: "Keep a current copy of each vital record where the recovery location can reach it without the network: on removable media in a locked, fire-resistant place and with a partner jurisdiction. Test the copies at each review. Staff are reached by the call-down list; the public by the jurisdiction's usual alerting channels.",
        positions: ["public_information_officer", "logistics_section_chief"],
      },
    ],
    continuity: {
      essentialFunctions: [
        { name: "Emergency management and the EOC", priority: 1, recoveryHours: 12, position: "incident_commander",
          description: "Coordinate the response, keep the common operating picture and request resources.",
          resources: ["EOC laptop with the offline map packet", "Radio"], vitalRecords: ["Emergency operations plan", "Contact and call-down lists"] },
        { name: "Public safety coordination", priority: 2, recoveryHours: 12, position: "liaison_officer",
          description: "Keep contact with dispatch, law enforcement, fire and EMS serving the jurisdiction.",
          resources: ["Radio on the mutual aid channel"], vitalRecords: ["Mutual aid agreements"] },
        { name: "Drinking water and wastewater", priority: 3, recoveryHours: 24, position: "logistics_section_chief",
          description: "Keep water safe to drink and wastewater contained; issue boil-water notices when needed.",
          resources: ["Generator for the pump station", "Water testing kit"], vitalRecords: ["System maps and operating procedures"] },
        { name: "Health clinic and public health", priority: 4, recoveryHours: 24, position: "liaison_officer",
          description: "Keep urgent care, medications and public health notices available to the community.",
          resources: ["Cold storage for medications"], vitalRecords: ["Patient records backup, held by the clinic"] },
        { name: "Communications and information technology", priority: 5, recoveryHours: 24, position: "public_information_officer",
          description: "Keep staff, partners and the public informed; restore the phones, network and accounts the other functions need.",
          resources: ["Satellite or cellular data link"], vitalRecords: ["Account and system recovery instructions, sealed"] },
        { name: "Government leadership and the governing body", priority: 6, recoveryHours: 72, position: "incident_commander",
          description: "Keep the government able to make decisions, declare emergencies and approve spending.",
          resources: ["A room for the governing body to meet"], vitalRecords: ["Constitution or charter, codes and ordinances", "Signature authorities"] },
        { name: "Social services and elder care", priority: 7, recoveryHours: 72, position: "planning_section_chief",
          description: "Reach elders and people who depend on care or deliveries; keep assistance payments flowing.",
          resources: ["List of people who need a check-in"], vitalRecords: ["Client rosters"] },
        { name: "Payroll and finance", priority: 8, recoveryHours: 168, position: "finance_admin_section_chief",
          description: "Pay staff, track emergency costs and keep the records FEMA and grantors will ask for.",
          resources: ["Check stock or a bank's offline process"], vitalRecords: ["Payroll register", "Bank and grant account information"] },
      ],
      recoveryLocations: [
        { name: "Alternate site", address: "", notes: "A community building with power backup where the EOC and essential staff can work. Name it and keep a key with the emergency manager." },
        { name: "Devolution site", address: "", notes: "A partner jurisdiction's EOC that performs the first functions if no local site can be used. Agree it in writing." },
      ],
      succession: [
        { role: "Emergency manager", successors: ["Deputy emergency manager", "Planning section chief"] },
        { role: "Chair of the governing body", successors: ["Vice chair", "Secretary of the governing body"] },
      ],
      delegations: [
        { authority: "Declare a local emergency", delegatedTo: "Vice chair of the governing body",
          when: "The chair cannot be reached within two hours of a request.", limits: "Until the chair or the governing body acts." },
        { authority: "Approve emergency purchases", delegatedTo: "Emergency manager",
          when: "While the EOC is activated.", limits: "Up to the limit the governing body sets; report each purchase at its next meeting." },
      ],
    },
  },
};

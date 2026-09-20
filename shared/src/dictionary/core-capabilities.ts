import { defineEnum, type Citation } from "./citations.js";

const NPG: Citation = {
  authority: "FEMA",
  document: "National Preparedness Goal, Second Edition (2015)",
  section: "Core Capabilities",
};

/**
 * The 32 Core Capabilities of the National Preparedness Goal. Three are common
 * to every mission area (Planning; Public Information and Warning; Operational
 * Coordination); the rest belong to Prevention, Protection, Mitigation,
 * Response, or Recovery, with a few shared across mission areas. An after-action
 * report scores observations and corrective actions against these capabilities,
 * which is how HSEEP and the National Preparedness System keep AARs comparable
 * across incidents and jurisdictions.
 */
export const CORE_CAPABILITIES = defineEnum(
  "npg.core_capabilities",
  [
    // Common to all mission areas
    "planning",
    "public_information_and_warning",
    "operational_coordination",
    // Prevention / Protection (shared)
    "intelligence_and_information_sharing",
    "interdiction_and_disruption",
    "screening_search_and_detection",
    // Prevention
    "forensics_and_attribution",
    // Protection
    "access_control_and_identity_verification",
    "cybersecurity",
    "physical_protective_measures",
    "risk_management_for_protection_programs_and_activities",
    "supply_chain_integrity_and_security",
    // Mitigation
    "community_resilience",
    "long_term_vulnerability_reduction",
    "risk_and_disaster_resilience_assessment",
    "threats_and_hazards_identification",
    // Response (infrastructure_systems is shared with Recovery)
    "critical_transportation",
    "environmental_response_health_and_safety",
    "fatality_management_services",
    "fire_management_and_suppression",
    "infrastructure_systems",
    "logistics_and_supply_chain_management",
    "mass_care_services",
    "mass_search_and_rescue_operations",
    "on_scene_security_protection_and_law_enforcement",
    "operational_communications",
    "public_health_healthcare_and_emergency_medical_services",
    "situational_assessment",
    // Recovery
    "economic_recovery",
    "health_and_social_services",
    "housing",
    "natural_and_cultural_resources",
  ],
  NPG,
);

/** Proper-noun display label for each core capability. */
export const CORE_CAPABILITY_LABELS: Readonly<Record<string, string>> = {
  planning: "Planning",
  public_information_and_warning: "Public Information and Warning",
  operational_coordination: "Operational Coordination",
  intelligence_and_information_sharing: "Intelligence and Information Sharing",
  interdiction_and_disruption: "Interdiction and Disruption",
  screening_search_and_detection: "Screening, Search, and Detection",
  forensics_and_attribution: "Forensics and Attribution",
  access_control_and_identity_verification: "Access Control and Identity Verification",
  cybersecurity: "Cybersecurity",
  physical_protective_measures: "Physical Protective Measures",
  risk_management_for_protection_programs_and_activities:
    "Risk Management for Protection Programs and Activities",
  supply_chain_integrity_and_security: "Supply Chain Integrity and Security",
  community_resilience: "Community Resilience",
  long_term_vulnerability_reduction: "Long-term Vulnerability Reduction",
  risk_and_disaster_resilience_assessment: "Risk and Disaster Resilience Assessment",
  threats_and_hazards_identification: "Threats and Hazards Identification",
  critical_transportation: "Critical Transportation",
  environmental_response_health_and_safety: "Environmental Response/Health and Safety",
  fatality_management_services: "Fatality Management Services",
  fire_management_and_suppression: "Fire Management and Suppression",
  infrastructure_systems: "Infrastructure Systems",
  logistics_and_supply_chain_management: "Logistics and Supply Chain Management",
  mass_care_services: "Mass Care Services",
  mass_search_and_rescue_operations: "Mass Search and Rescue Operations",
  on_scene_security_protection_and_law_enforcement:
    "On-scene Security, Protection, and Law Enforcement",
  operational_communications: "Operational Communications",
  public_health_healthcare_and_emergency_medical_services:
    "Public Health, Healthcare, and Emergency Medical Services",
  situational_assessment: "Situational Assessment",
  economic_recovery: "Economic Recovery",
  health_and_social_services: "Health and Social Services",
  housing: "Housing",
  natural_and_cultural_resources: "Natural and Cultural Resources",
};

/** Mission area each capability belongs to (common capabilities span all). */
export const CORE_CAPABILITY_MISSION_AREAS: Readonly<Record<string, string>> = {
  planning: "common",
  public_information_and_warning: "common",
  operational_coordination: "common",
  intelligence_and_information_sharing: "prevention_protection",
  interdiction_and_disruption: "prevention_protection",
  screening_search_and_detection: "prevention_protection",
  forensics_and_attribution: "prevention",
  access_control_and_identity_verification: "protection",
  cybersecurity: "protection",
  physical_protective_measures: "protection",
  risk_management_for_protection_programs_and_activities: "protection",
  supply_chain_integrity_and_security: "protection",
  community_resilience: "mitigation",
  long_term_vulnerability_reduction: "mitigation",
  risk_and_disaster_resilience_assessment: "mitigation",
  threats_and_hazards_identification: "mitigation",
  critical_transportation: "response",
  environmental_response_health_and_safety: "response",
  fatality_management_services: "response",
  fire_management_and_suppression: "response",
  infrastructure_systems: "response_recovery",
  logistics_and_supply_chain_management: "response",
  mass_care_services: "response",
  mass_search_and_rescue_operations: "response",
  on_scene_security_protection_and_law_enforcement: "response",
  operational_communications: "response",
  public_health_healthcare_and_emergency_medical_services: "response",
  situational_assessment: "response",
  economic_recovery: "recovery",
  health_and_social_services: "recovery",
  housing: "recovery",
  natural_and_cultural_resources: "recovery",
};

const HSEEP: Citation = {
  authority: "FEMA",
  document: "Homeland Security Exercise and Evaluation Program (HSEEP), 2020",
  section: "Core Capability Elements (POETE)",
};

/**
 * The core-capability element an observation or corrective action addresses:
 * the POETE elements (Planning, Organization, Equipment, Training, Exercises)
 * HSEEP uses to classify where a capability gap lives, plus "none" when the
 * item is not tied to a single element. WebEOC's AAR exposes the same field.
 */
export const CAPABILITY_ELEMENT = defineEnum(
  "npg.capability_element",
  ["none", "planning", "organization", "equipment", "training", "exercises"],
  HSEEP,
);

/** Display label for each capability element. */
export const CAPABILITY_ELEMENT_LABELS: Readonly<Record<string, string>> = {
  none: "None",
  planning: "Planning",
  organization: "Organization",
  equipment: "Equipment",
  training: "Training",
  exercises: "Exercises",
};

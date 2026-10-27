// MOCK DATA for the UI prototype. Legislator names are fictional.
// Shape follows packages/contract/vis.schema.json + a taxonomy layer (category -> subcategory).
window.OWL_TAXONOMY = [
  { id: "public_safety", name: "Public Safety", subs: [
    { id: "guns", name: "Gun Policy" }, { id: "policing", name: "Policing & Reform" }, { id: "drugs", name: "Drug Policy" } ] },
  { id: "energy", name: "Energy", subs: [
    { id: "renewables", name: "Renewables" }, { id: "nuclear", name: "Nuclear" }, { id: "oil_gas", name: "Oil & Gas" } ] },
  { id: "healthcare", name: "Healthcare", subs: [
    { id: "aca", name: "ACA / Coverage" }, { id: "drug_pricing", name: "Drug Pricing" } ] },
  { id: "immigration", name: "Immigration", subs: [
    { id: "border", name: "Border Security" }, { id: "daca", name: "DACA / Pathways" } ] },
  { id: "technology_ai", name: "Technology & AI", subs: [
    { id: "ai_regulation", name: "AI Regulation" }, { id: "data_centers", name: "Data Centers" }, { id: "privacy", name: "Data Privacy" } ] }
];

const P = (id, name, district, party, gender, since) => ({ id, kind: "person", name, attrs: [
  { attr: "district", value: district, source: "https://api.congress.gov/v3/member/" + id },
  { attr: "party", value: party, source: "https://api.congress.gov/v3/member/" + id },
  { attr: "gender", value: gender, source: "https://api.congress.gov/v3/member/" + id },
  { attr: "since", value: since, source: "https://api.congress.gov/v3/member/" + id } ] });

window.OWL_PEOPLE = [
  P("p01", "Rep. Alicia Marquez", "CA-12", "D", "F", 2019), P("p02", "Rep. Daniel Okafor", "CA-27", "D", "M", 2021),
  P("p03", "Rep. Grace Lindqvist", "CA-45", "R", "F", 2023), P("p04", "Rep. Thomas Beaumont", "CA-23", "R", "M", 2013),
  P("p05", "Rep. Priya Raman", "CA-17", "D", "F", 2017), P("p06", "Rep. Samuel Whitfield", "CA-48", "R", "M", 2015),
  P("p07", "Rep. Mei-Ling Tsao", "CA-36", "D", "F", 2021), P("p08", "Rep. Carlos Ibanez", "CA-21", "D", "M", 2019),
  P("p09", "Rep. Harold Finch", "CA-01", "R", "M", 2011), P("p10", "Rep. Nadia Rousseau", "CA-50", "D", "F", 2023)
];

// edges: person -> subcategory topic. score in [-1, 1]; direction derived from score.
const E = (from, sub, score, linkage, conf, quote, src, bill) => ({
  from, to: sub, score, direction: score > 0.15 ? "support" : score < -0.15 ? "oppose" : "neutral",
  linkage, llm_confidence: conf, quote, source: src, bill, model: "muse-spark-1.3" });

window.OWL_EDGES = [
  E("p01","guns", 0.82,"super_high","high","We cannot keep burying children while weapons of war are sold without so much as a background check.","https://www.congress.gov/congressional-record/mock/1","H.R. 4410 Background Checks Act"),
  E("p02","guns", 0.65,"high","high","I cosponsor this bill because universal background checks are common sense, not confiscation.","https://www.congress.gov/congressional-record/mock/2","H.R. 4410 Background Checks Act"),
  E("p03","guns",-0.71,"high","high","This bill punishes law-abiding owners and does nothing to stop criminals who ignore the law anyway.","https://www.congress.gov/congressional-record/mock/3","H.R. 4410 Background Checks Act"),
  E("p04","guns",-0.88,"super_high","super_high","The Second Amendment is not a suggestion. I will vote no on every attempt to erode it.","https://www.congress.gov/congressional-record/mock/4","H.R. 4410 Background Checks Act"),
  E("p05","guns", 0.40,"mid","mid","Red-flag laws, implemented with due process, save lives in California.","https://www.cnn.com/mock/5","H.R. 2377 Federal Extreme Risk"),
  E("p06","guns",-0.35,"mid","mid","Enforcement of existing law should come before any new federal mandate.","https://www.foxnews.com/mock/6","H.R. 4410 Background Checks Act"),
  E("p07","guns", 0.55,"high","mid","Our district has lost too many to preventable gun violence; I support closing the gun-show loophole.","https://www.congress.gov/congressional-record/mock/7","H.R. 4410 Background Checks Act"),
  E("p09","guns",-0.10,"low","low","I have concerns about the implementation timeline but have not decided how I will vote.","https://www.congress.gov/congressional-record/mock/9","H.R. 4410 Background Checks Act"),
  E("p10","guns", 0.30,"mid","low","Safe-storage requirements are a reasonable middle ground.","https://www.congress.gov/congressional-record/mock/10","H.R. 1151 Safe Storage"),

  E("p01","policing", 0.60,"high","high","Accountability and funding are not opposites; this bill delivers both.","https://www.congress.gov/congressional-record/mock/11","H.R. 1280 Justice in Policing"),
  E("p04","policing",-0.75,"high","high","Defunding or restricting our officers will make every neighborhood less safe.","https://www.congress.gov/congressional-record/mock/12","H.R. 1280 Justice in Policing"),
  E("p08","policing", 0.45,"mid","mid","Body cameras protect good officers as much as they protect the public.","https://www.congress.gov/congressional-record/mock/13","H.R. 1280 Justice in Policing"),
  E("p06","policing",-0.20,"low","mid","Qualified immunity reform needs more study before a federal mandate.","https://www.congress.gov/congressional-record/mock/14","H.R. 1280 Justice in Policing"),

  E("p05","data_centers", 0.70,"high","high","AI infrastructure is the new interstate highway; California should lead, with strong grid and water safeguards.","https://www.congress.gov/congressional-record/mock/15","H.R. 6110 AI Infrastructure"),
  E("p07","data_centers",-0.50,"mid","high","Our water tables cannot absorb another hyperscale campus without binding limits.","https://www.congress.gov/congressional-record/mock/16","H.R. 6110 AI Infrastructure"),
  E("p09","data_centers", 0.35,"mid","mid","Rural districts like mine need the jobs these facilities bring.","https://www.congress.gov/congressional-record/mock/17","H.R. 6110 AI Infrastructure"),
  E("p02","data_centers", 0.10,"low","low","I support the investment but want to see the energy-sourcing requirements strengthened.","https://www.congress.gov/congressional-record/mock/18","H.R. 6110 AI Infrastructure"),
  E("p03","data_centers", 0.60,"high","mid","Federal permitting reform is overdue; data centers should not wait five years for approval.","https://www.congress.gov/congressional-record/mock/19","H.R. 6110 AI Infrastructure"),

  E("p05","ai_regulation", 0.55,"high","high","We need guardrails that are specific enough to enforce and flexible enough not to freeze innovation.","https://www.congress.gov/congressional-record/mock/20","S. 3312 AI Accountability"),
  E("p10","ai_regulation", 0.75,"super_high","high","Algorithmic transparency is a civil-rights issue in 2026.","https://www.congress.gov/congressional-record/mock/21","S. 3312 AI Accountability"),
  E("p04","ai_regulation",-0.60,"high","high","Europe regulated first and innovated last. We should not copy that mistake.","https://www.foxnews.com/mock/22","S. 3312 AI Accountability"),

  E("p08","border", 0.20,"mid","mid","Border security and humane processing are both achievable; the funding must go to both.","https://www.congress.gov/congressional-record/mock/23","H.R. 2 Secure the Border"),
  E("p06","border", 0.85,"super_high","super_high","Finish the wall, fund the agents, end catch-and-release.","https://www.foxnews.com/mock/24","H.R. 2 Secure the Border"),
  E("p01","border",-0.65,"high","high","This bill militarizes our communities and separates families. I vote no.","https://www.congress.gov/congressional-record/mock/25","H.R. 2 Secure the Border"),

  E("p07","renewables", 0.80,"super_high","high","Solar and storage are already the cheapest electrons in California; the federal credit should follow the market.","https://www.congress.gov/congressional-record/mock/26","H.R. 5376 Clean Energy Credits"),
  E("p09","renewables",-0.30,"mid","mid","Subsidies that favor intermittent sources leave my constituents paying for a less reliable grid.","https://www.congress.gov/congressional-record/mock/27","H.R. 5376 Clean Energy Credits"),
  E("p03","nuclear", 0.65,"high","high","Advanced nuclear is the only firm, zero-carbon option we have at scale.","https://www.congress.gov/congressional-record/mock/28","S. 1111 ADVANCE Act"),
  E("p10","nuclear", 0.25,"mid","low","I am open to new reactor designs if the waste question is answered first.","https://www.congress.gov/congressional-record/mock/29","S. 1111 ADVANCE Act"),
  E("p02","drug_pricing", 0.70,"high","high","Medicare should negotiate drug prices like every other buyer in the world.","https://www.congress.gov/congressional-record/mock/30","H.R. 3 Lower Drug Costs"),
  E("p06","drug_pricing",-0.55,"high","mid","Price controls will cost us the next generation of cures.","https://www.foxnews.com/mock/31","H.R. 3 Lower Drug Costs")
];

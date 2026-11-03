#!/usr/bin/env python3
"""Seed contract-B issues.json (level 3) from bill metadata, no model calls.

Every reported bill carries a CRS policy area and legislative subjects (BILLSTATUS), and we know
its reporting committee (bill_domain.jsonl). This maps (committee, subjects) -> a curated issue
whose parent is one of Kurt's subcommittee ids (taxonomy.json), so Muse can map statements to
existing issue ids instead of proposing hundreds of new ones.

Outputs (out_full/owl/):
  issues.json         contract-B file, validated by packages/contract/validate.mjs
  bill_issues.jsonl   {bill_id, issues:[...], method, committee} one row per bill
  issues_report.md    coverage table for the team issue

Usage: python3 -I m1/seed_issues.py [--out out_full]
"""
import json, re, sys, collections
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[sys.argv.index("--out") + 1]) if "--out" in sys.argv else ROOT / "out_full"
import sys as _sys
_sys.path.insert(0, str(ROOT))
from m1.paths import repo_root as _repo_root  # noqa: E402
_REPO = _repo_root()
TAXONOMY = (_REPO / "data" / "taxonomy.json") if _REPO else ROOT.parent / "owl" / "data" / "taxonomy.json"

# ---------------------------------------------------------------------------------------------
# Curated seed. One entry per issue: (committee code as in bill_domain, parent subcommittee id,
# name, matching legislative subjects, matching policy areas). Matching is restricted to bills
# reported by that committee, so a generic subject like "Fires" means wildfire under Natural
# Resources and disaster tax relief under Ways and Means.
# ---------------------------------------------------------------------------------------------
SEED = [
    # Natural Resources
    ("HSII", "hsii-lands",  "Federal Land Transfers",            ["Land transfers"], []),
    ("HSII", "hsii-lands",  "Public Lands and Parks",            ["Land use and conservation", "Parks, recreation areas, trails", "Geography and mapping"], ["Public Lands and Natural Resources"]),
    ("HSII", "hsii-lands",  "Forest Management and Wildfire",    ["Forests, forestry, trees", "Fires"], []),
    ("HSII", "hsii-water",  "Wildlife and Fisheries",            ["Wildlife conservation and habitat protection", "Marine and coastal resources, fisheries", "Endangered and threatened species"], []),
    ("HSII", "hsii-water",  "Western Water Supply",             ["Water use and supply", "Dams and canals", "Water storage"], ["Water Resources Development"]),
    ("HSII", "hsii-indian", "Tribal Lands and Sovereignty",      ["Indian lands and resources rights", "Federal-Indian relations", "Indian social and development programs"], ["Native Americans"]),
    ("HSII", "hsii-energy", "Mining and Mineral Resources",      ["Mining", "Oil and gas", "Alternative and renewable resources", "Electric power generation and transmission"], ["Energy"]),
    ("HSII", "hsii-oversight", "Environmental Review (NEPA)",    ["Environmental assessment, monitoring, research", "Environmental regulatory procedures"], ["Environmental Protection"]),
    # Financial Services
    ("HSBA", "hsba-institutions", "Bank Regulation",             ["Banking and financial institutions regulation", "Bank accounts, deposits, capital", "Credit and credit markets", "Consumer credit"], []),
    ("HSBA", "hsba-institutions", "Financial Stability",         ["Financial crises and stabilization", "Economic performance and conditions"], []),
    ("HSBA", "hsba-capital", "Securities and Capital Markets",   ["Securities", "Securities and Exchange Commission (SEC)", "Corporate finance and management", "Financial services and investments", "Business investment and capital"], ["Finance and Financial Sector"]),
    ("HSBA", "hsba-capital", "Corporate Disclosure and Audit",   ["Business records", "Accounting and auditing"], []),
    ("HSBA", "hsba-capital", "Small Business Capital Access",    ["Small business"], []),
    ("HSBA", "hsba-digital", "Digital Assets and Fintech",       ["Currency", "Computers and information technology", "Internet, web applications, social media", "Advanced technology and technological innovations"], []),
    ("HSBA", "hsba-natsec", "Financial Crime and Sanctions",     ["Fraud offenses and financial crimes", "Sanctions", "Terrorism financing"], []),
    ("HSBA", "hsba-natsec", "China and International Finance",   ["Asia", "China", "Foreign and international banking", "International monetary system and foreign exchange", "Multilateral development programs"], ["International Affairs", "Foreign Trade and International Finance"]),
    ("HSBA", "hsba-housing", "Housing Finance",                  ["Housing finance and home ownership", "Housing and community development funding", "Public housing", "Insurance industry and regulation"], ["Housing and Community Development"]),
    # Energy and Commerce
    ("HSIF", "hsif-energy", "Electric Grid Reliability",         ["Electric power generation and transmission", "Energy storage, supplies, demand", "Pipelines", "Nuclear power"], ["Energy"]),
    ("HSIF", "hsif-energy", "Energy Efficiency Standards",       ["Energy efficiency and conservation", "Building construction", "Household appliances"], []),
    ("HSIF", "hsif-comms",  "Broadband and Spectrum",            ["Telephone and wireless communication", "Broadcasting, cable, digital technologies", "Emergency communications systems", "Federal Communications Commission (FCC)"], []),
    ("HSIF", "hsif-comms",  "Online Platforms and Data Privacy", ["Internet, web applications, social media", "Data collection, sharing, protection", "Computer security and identity theft", "Computers and information technology"], ["Science, Technology, Communications"]),
    ("HSIF", "hsif-health", "Health Programs and Research",      ["Health programs administration and funding", "Health promotion and preventive care", "Medical research", "Prescription drugs", "Medicare", "Medicaid", "Health care coverage and access"], ["Health"]),
    ("HSIF", "hsif-innovation", "Consumer Protection",           ["Consumer affairs", "Product safety and quality", "Motor vehicles", "Advanced technology and technological innovations"], ["Commerce"]),
    ("HSIF", "hsif-environment", "Environmental Regulation",     ["Environmental regulatory procedures", "Environmental assessment, monitoring, research", "Air quality", "Hazardous wastes and toxic substances", "Solid waste and recycling"], ["Environmental Protection"]),
    # Education and Workforce
    ("HSED", "hsed-higher", "Higher Education and Student Aid",  ["Higher education", "Student aid and college costs", "Government lending and loan guarantees"], []),
    ("HSED", "hsed-k12",    "K-12 Education",                    ["Elementary and secondary education", "School administration", "Teaching, teachers, curricula", "Education programs funding"], ["Education"]),
    ("HSED", "hsed-k12",    "Child Care",                        ["Child care and development"], []),
    ("HSED", "hsed-k12",    "Civil Rights in Schools",           ["Sex, gender, sexual orientation discrimination", "Racial and ethnic relations", "Religion", "Athletes"], []),
    ("HSED", "hsed-protections", "Wages and Labor Standards",    ["Labor standards", "Wages and earnings", "Worker safety and health", "Employee hiring"], ["Labor and Employment"]),
    ("HSED", "hsed-help",   "Retirement and Employee Benefits",  ["Employee benefits and pensions", "Health care costs and insurance"], []),
    ("HSED", "hsed-help",   "Labor Relations and Unions",        ["Labor-management relations", "Employee leave"], []),
    # Veterans' Affairs
    ("HSVR", "hsvr-health", "Veterans Health Care",              ["Veterans' medical care", "Health personnel", "Mental health", "Health technology, devices, supplies", "Prescription drugs"], []),
    ("HSVR", "hsvr-disability", "Veterans Benefits and Compensation", ["Veterans' pensions and compensation", "Cemeteries and funerals", "Disability assistance"], []),
    ("HSVR", "hsvr-economic", "Veterans Education and Employment", ["Veterans' education, employment, rehabilitation", "Higher education", "Employment and training programs", "Student aid and college costs"], []),
    ("HSVR", "hsvr-economic", "Veterans Housing and Loans",      ["Veterans' loans, housing, homeless programs", "Housing finance and home ownership", "Government lending and loan guarantees"], []),
    ("HSVR", "hsvr-tech",   "VA Technology Modernization",       ["Computers and information technology"], []),
    ("HSVR", "hsvr-oversight", "VA Operations and Oversight",    ["Veterans' organizations and recognition", "Motor vehicles"], ["Armed Forces and National Security"]),
    # Ways and Means
    ("HSWM", "hswm-tax",    "Tax Administration and IRS",        ["Tax administration and collection, taxpayers", "Internal Revenue Service (IRS)", "Income tax deductions", "Income tax credits", "Taxation"], ["Taxation"]),
    ("HSWM", "hswm-tax",    "Disaster Tax Relief",               ["Natural disasters", "Fires", "Forests, forestry, trees", "Disaster relief and insurance"], []),
    ("HSWM", "hswm-ss",     "Social Security",                   ["Social Security Administration", "Social security and elderly assistance"], []),
    ("HSWM", "hswm-welfare", "Child Welfare and Foster Care",    ["Adoption and foster care", "Child safety and welfare"], ["Families", "Social Welfare"]),
    ("HSWM", "hswm-welfare", "Unemployment and Work Programs",   ["Unemployment", "Employment and training programs", "Fraud offenses and financial crimes"], []),
    ("HSWM", "hswm-health", "Health Care Tax Policy",            ["Health care costs and insurance", "Cardiovascular and respiratory health", "Health care coverage and access"], ["Health"]),
    ("HSWM", "hswm-oversight", "Treasury Oversight",             ["Congressional-executive branch relations", "Specialized courts", "Computers and information technology"], []),
    # Small Business
    ("HSSM", "hssm-growth", "SBA Lending",                       ["Government lending and loan guarantees", "Small Business Administration", "Business investment and capital"], []),
    ("HSSM", "hssm-innovation", "Small Business Programs",       ["Small business", "Advanced technology and technological innovations", "Technology assessment", "Women in business", "Employee hiring", "Disability and paralysis", "Disability assistance"], ["Commerce"]),
    ("HSSM", "hssm-oversight", "Small Business Cyber and Fraud", ["Computer security and identity theft", "Computers and information technology", "Fraud offenses and financial crimes", "Administrative remedies"], []),
    ("HSSM", "hssm-rural",  "Rural Small Business and Manufacturing", ["Rural conditions and development", "Manufacturing"], []),
    # Transportation and Infrastructure
    ("HSPW", "hspw-aviation", "Aviation Safety",                 ["Aviation and airports"], []),
    ("HSPW", "hspw-highways", "Highway and Transit Safety",      ["Transportation safety and security", "Roads and highways", "Public transit"], ["Transportation and Public Works"]),
    ("HSPW", "hspw-water",  "Water Infrastructure and Quality",  ["Water quality", "Navigation, waterways, harbors", "Marine pollution", "Lakes and rivers", "Water resources funding", "Wetlands"], ["Water Resources Development", "Environmental Protection"]),
    ("HSPW", "hspw-coastguard", "Maritime Transportation",       ["Marine and inland water transportation", "Coast guard"], []),
    ("HSPW", "hspw-econdev", "Public Buildings and Emergency Management", ["Museums, exhibitions, cultural centers", "U.S. Capitol", "Commemorative events and holidays", "Emergency planning and evacuation", "Fires"], ["Emergency Management", "Government Operations and Politics", "Congress"]),
    # Judiciary
    ("HSJU", "hsju-crime",  "Criminal Sentencing",               ["Criminal procedure and sentencing", "Violent crime", "Criminal justice information and records", "Detention of persons", "Sex offenses"], ["Crime and Law Enforcement"]),
    ("HSJU", "hsju-crime",  "Gun Policy",                        ["Firearms and explosives"], []),
    ("HSJU", "hsju-crime",  "Law Enforcement Support",           ["Law enforcement officers", "Law enforcement administration and funding"], []),
    ("HSJU", "hsju-immigration", "Immigration Enforcement",      ["Immigration status and procedures", "Border security and unlawful immigration", "Immigrant health and welfare", "Smuggling and trafficking", "Human trafficking", "Visas and passports"], ["Immigration"]),
    ("HSJU", "hsju-courts", "Federal Courts",                    ["Judicial procedure and administration", "Legal fees and court costs", "State and local courts", "Federal district courts", "Civil actions and liability"], ["Law"]),
    # Homeland Security
    ("HSHM", "hshm-border", "Border Security",                   ["Border security and unlawful immigration", "Immigration status and procedures", "Drug trafficking and controlled substances", "Smuggling and trafficking"], ["Immigration"]),
    ("HSHM", "hshm-ct",     "Counterterrorism",                  ["Terrorism", "Intelligence activities, surveillance, classified information"], []),
    ("HSHM", "hshm-transport", "Aviation and Transportation Security", ["Aviation and airports", "Transportation safety and security"], ["Transportation and Public Works"]),
    ("HSHM", "hshm-cyber",  "Cybersecurity",                     ["Computer security and identity theft", "Computers and information technology", "Advanced technology and technological innovations"], []),
    ("HSHM", "hshm-emergency", "Emergency Management",           ["Emergency planning and evacuation", "Natural disasters", "Disaster relief and insurance"], ["Emergency Management"]),
    ("HSHM", "hshm-oversight", "DHS Workforce and Operations",   ["Law enforcement officers", "Employment and training programs", "Mental health", "Service animals", "Animal protection and human-animal relationships", "Law enforcement administration and funding"], ["Armed Forces and National Security"]),
    # Oversight and Government Reform
    ("HSGO", "hsgo-law",    "District of Columbia Governance",   ["District of Columbia"], []),
    ("HSGO", "hsgo-law",    "Federal Law Enforcement",           ["Criminal procedure and sentencing", "Crimes against property", "Law enforcement officers", "Violent crime", "Assault and harassment offenses", "Sex offenses", "Immigration status and procedures"], ["Crime and Law Enforcement"]),
    ("HSGO", "hsgo-doge",   "Federal Workforce and Ethics",      ["Office of Management and Budget (OMB)", "Executive Office of the President", "Government ethics and transparency, public corruption", "Employment discrimination and employee rights", "Congressional-executive branch relations"], ["Government Operations and Politics"]),
    ("HSGO", "hsgo-cyber",  "Federal IT and Cybersecurity",      ["Computers and information technology", "Internet, web applications, social media", "Computer security and identity theft"], []),
    # House Administration
    ("HSHA", "hsha-elections", "Election Administration",        ["Elections, voting, political campaign regulation", "Congressional elections", "Florida", "Texas"], []),
    ("HSHA", "hsha-modernization", "House Operations",           ["Congressional committees", "Congressional operations and organization", "Government Publishing Office (GPO)", "Libraries and archives", "Computers and information technology"], ["Congress", "Government Operations and Politics", "Arts, Culture, Religion"]),
    # Science, Budget, Agriculture, Armed Services (few reports each)
    ("HSSY", "hssy-research", "Research and Technology Transfer", ["Research and development", "Technology transfer and commercialization", "Research administration and funding"], ["Science, Technology, Communications", "Energy"]),
    ("HSBU", "hsbu",        "Federal Budget and Deficit",        ["Budget deficits and national debt", "Budget process"], ["Economics and Public Finance"]),
    ("HSAG", "hsag-farm",   "Farm Trade and Food Safety",        ["Agricultural marketing and promotion", "Agricultural practices and innovations", "Agricultural trade", "Food supply, safety, and labeling", "Grain"], ["Agriculture and Food", "Finance and Financial Sector"]),
    ("HSAS", "hsas-readiness", "Defense Authorization",          ["Military personnel and dependents", "Military command and structure", "Military medicine", "Military civil functions"], ["Armed Forces and National Security", "Transportation and Public Works"]),
]

# Appropriations: one issue per subcommittee, matched on the bill title.
APPROPS = [
    ("hsap-defense",     "Defense Appropriations",                  r"Department of Defense Appropriations"),
    ("hsap-homeland",    "Homeland Security Appropriations",        r"Homeland Security Appropriations"),
    ("hsap-energy",      "Energy and Water Appropriations",         r"Energy and Water"),
    ("hsap-interior",    "Interior and Environment Appropriations", r"Interior, Environment"),
    ("hsap-labor",       "Labor, HHS, Education Appropriations",    r"Labor, Health and Human Services"),
    ("hsap-milcon",      "Military Construction and VA Appropriations", r"[Mm]ilitary [Cc]onstruction"),
    ("hsap-thud",        "Transportation and HUD Appropriations",   r"Transportation, Housing"),
    ("hsap-ag",          "Agriculture and FDA Appropriations",      r"^Agriculture, Rural Development"),
    ("hsap-cjs",         "Commerce, Justice, Science Appropriations", r"Commerce, Justice, Science"),
    ("hsap-fsgg",        "Financial Services Appropriations",       r"Financial Services and General Government"),
    ("hsap-legislative", "Legislative Branch Appropriations",       r"[Ll]egislative [Bb]ranch"),
    ("hsap-state",       "National Security and State Appropriations", r"[Nn]ational [Ss]ecurity, Department of State"),
]
APPROPS_FALLBACK = ("hsas-readiness", "Defense Authorization")  # NDAA reported via Appropriations' package

slug = lambda s: re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", s.lower())).strip("-")


def main():
    tax = json.load(open(TAXONOMY))
    leaf = {s["id"] for c in tax["committees"] for s in c["subcommittees"]} | {c["id"] for c in tax["committees"] if not c["subcommittees"]}
    bills = {b["bill_id"]: b for b in map(json.loads, open(OUT / "bills.jsonl"))}
    comm_of = collections.defaultdict(set)
    for r in map(json.loads, open(OUT / "bill_domain.jsonl")):
        if r["domain_id"].startswith("HS") and r["linkage"] == "super_high":
            comm_of[r["bill_id"]].add(r["domain_id"])

    issues, by_id = [], {}
    def add(name, parent):
        iid = slug(name)
        assert parent in leaf, (name, parent)
        if iid not in by_id:
            by_id[iid] = {"id": iid, "name": name, "parent": parent}
            issues.append(by_id[iid])
        return iid
    for _, parent, name, _, _ in SEED: add(name, parent)
    for parent, name, _ in APPROPS: add(name, parent)

    rows, method_count, unmapped = [], collections.Counter(), []
    for bid, b in bills.items():
        comms = comm_of.get(bid, set())
        subj, pa, title = set(b["legislative_subjects"]), b["policy_area"], b["title"]
        hits = collections.Counter(); method = None
        if "HSAP" in comms:
            for parent, name, rx in APPROPS:
                if re.search(rx, title): hits[slug(name)] += 10
            if not hits and re.search(r"National Defense Authorization", title): hits[slug(APPROPS_FALLBACK[1])] += 10
            method = "title"
        for comm, parent, name, subjects, areas in SEED:
            if comm not in comms: continue
            n = len(subj & set(subjects)) * 2 + (1 if pa in areas else 0)
            if n: hits[slug(name)] += n
        if hits:
            best = [i for i, _ in hits.most_common(2) if hits[i] >= max(hits.values()) * 0.5][:2]
            rows.append({"bill_id": bid, "label": b["label"], "committees": sorted(comms), "issues": best, "method": method or "subjects", "policy_area": pa})
            method_count[method or "subjects"] += 1
        else:
            rows.append({"bill_id": bid, "label": b["label"], "committees": sorted(comms), "issues": [], "method": "unmapped", "policy_area": pa})
            unmapped.append((bid, sorted(comms), pa, b["legislative_subjects"][:5], title[:90]))

    owl = OUT / "owl"; owl.mkdir(exist_ok=True)
    json.dump({"_meta": {"description": "Seed level-3 issues derived from bill metadata (CRS policy area + legislative subjects of every bill reported by the committee), parent = House subcommittee. No model calls. Generated by services/ingest (module 1); process may add model-proposed issues on top."}, "issues": issues}, open(owl / "issues.json", "w"), indent=1, ensure_ascii=False)
    with open(owl / "bill_issues.jsonl", "w") as f:
        for r in rows: f.write(json.dumps(r, ensure_ascii=False) + "\n")

    per_issue = collections.Counter(i for r in rows for i in r["issues"])
    lines = ["# Seed issues coverage", "", f"{len(issues)} issues; {len(bills)} reported bills; mapped {len(bills) - len(unmapped)} ({method_count}); unmapped {len(unmapped)}", "",
             "| issue | parent | bills |", "|---|---|---|"]
    for i in sorted(issues, key=lambda i: -per_issue[i["id"]]): lines.append(f"| {i['name']} | {i['parent']} | {per_issue[i['id']]} |")
    lines += ["", "## Unmapped bills (committee, policy area, first subjects, title)", ""]
    for u in unmapped: lines.append(f"- {u[0]} {u[1]} | {u[2]} | {u[3]} | {u[4]}")
    (owl / "issues_report.md").write_text("\n".join(lines))
    print(f"{len(issues)} issues -> {owl/'issues.json'}; bills mapped {len(bills)-len(unmapped)}/{len(bills)}; unmapped {len(unmapped)}; issues with 0 bills: {[i['id'] for i in issues if per_issue[i['id']]==0]}")


if __name__ == "__main__":
    main()

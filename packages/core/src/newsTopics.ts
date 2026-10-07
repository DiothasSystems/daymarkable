/**
 * The Daily Update's topics: one fixed list, and one brief a night that covers all of it.
 *
 * Until October 2026 each customer typed their own topics and their own brief was searched for them
 * — about $0.09 a customer a night, which grows with every subscriber. Now the night's brief is
 * written ONCE per edition for every topic below, stored, and each customer's Daily Update is cut
 * from it by the topics they ticked. The cost is fixed (about $0.65 a night for 36 topics) however
 * many customers there are, and is booked to the house like the crossword's (rule 16).
 *
 * Editions are regional, because "the economy" and "sport" mean different things in New York and in
 * London. Only the US edition is written for now (founder's decision, 2026-10-07): a Europe edition
 * waits for production and enough European subscribers to be worth a second nightly run. When it
 * comes, it gets its own `brief` lines below and its own sports, and `editionFor` starts answering
 * "eu" for European timezones.
 *
 * Ids are stored in each customer's settings, so they never change once shipped. A label can.
 */

export type NewsEdition = "us";

export type NewsTopicGroup = "Technology" | "Business" | "World and society" | "Pop culture" | "Sports";

export interface NewsTopic {
  id: string;
  label: string;
  group: NewsTopicGroup;
  /** What the topic covers, as the brief's writer is told it. Steers the one search it gets. */
  brief: string;
}

const t = (group: NewsTopicGroup, id: string, label: string, brief: string): NewsTopic => ({ id, label, group, brief });

/** In the order the picker shows them and the Daily Update prints them. */
export const NEWS_TOPICS: readonly NewsTopic[] = [
  t("Technology", "ai", "Artificial intelligence", "AI models, companies, research, products and regulation"),
  t("Technology", "consumer-tech", "Consumer tech and gadgets", "phones, computers, wearables and device launches"),
  t("Technology", "cybersecurity", "Cybersecurity", "breaches, ransomware, vulnerabilities and security policy"),
  t("Technology", "big-tech", "Big Tech and regulation", "Apple, Google, Microsoft, Amazon, Meta; antitrust and tech policy"),
  t("Technology", "startups", "Startups and venture capital", "funding rounds, IPOs, notable startups and investors"),
  t("Technology", "semiconductors", "Semiconductors and hardware", "chipmakers, fabs, supply chains and export rules"),
  t("Technology", "space", "Space and science", "launches, NASA and SpaceX, and major scientific findings"),
  t("Technology", "ev-clean-energy", "EVs and clean energy", "electric vehicles, batteries, solar, wind and the grid"),
  t("Technology", "telecom", "Telecom", "carriers, 5G and broadband, spectrum, satellite internet and FCC decisions"),

  t("Business", "markets", "Stock markets", "US stocks, the major indexes and notable market moves"),
  t("Business", "economy", "Economy and interest rates", "the Fed, inflation, jobs and growth data"),
  t("Business", "earnings", "Corporate earnings", "results and guidance from major US companies"),
  t("Business", "mergers", "Mergers and acquisitions", "announced and completed deals, and regulators' rulings on them"),
  t("Business", "real-estate", "Real estate and housing", "home prices, mortgage rates, commercial property"),
  t("Business", "energy", "Energy and commodities", "oil, gas, gold and other commodity markets"),
  t("Business", "crypto", "Crypto and fintech", "cryptocurrency markets and regulation, payments and fintech companies"),
  t("Business", "retail", "Retail and consumer brands", "retailers, consumer spending and major brands"),
  t("Business", "personal-finance", "Personal finance", "savings and loan rates, taxes, retirement and household money news"),

  t("World and society", "world", "World news", "the most significant international events"),
  t("World and society", "politics", "Politics and policy", "US federal politics: Congress, the White House, the Supreme Court and elections. Report it neutrally and factually, with no opinion"),
  t("World and society", "health", "Health and medicine", "medical research, drug approvals, public health"),
  t("World and society", "climate", "Climate and environment", "climate science and policy, extreme weather events, conservation"),

  t("Pop culture", "movies", "Movies and box office", "releases, box office results, awards and studio news"),
  t("Pop culture", "tv-streaming", "TV and streaming", "shows, streaming services and ratings"),
  t("Pop culture", "music", "Music", "releases, charts, tours and the music industry"),
  t("Pop culture", "video-games", "Video games", "game releases, consoles and the games industry"),
  t("Pop culture", "celebrity", "Celebrity news", "the most talked-about celebrity stories"),
  t("Pop culture", "books", "Books and publishing", "notable books, bestsellers, prizes and publishing news"),
  t("Pop culture", "fashion", "Fashion and style", "fashion houses, shows and trends"),

  t("Sports", "nfl", "NFL", "NFL games, results, trades and injuries"),
  t("Sports", "nba", "NBA", "NBA games, results, trades and injuries"),
  t("Sports", "mlb", "MLB", "MLB games, results, trades and injuries"),
  t("Sports", "nhl", "NHL", "NHL games, results, trades and injuries"),
  t("Sports", "soccer", "Soccer", "MLS, the Premier League, the Champions League and the US national teams"),
  t("Sports", "college-sports", "College football and basketball", "NCAA football and men's and women's basketball"),
  t("Sports", "golf-tennis", "Golf and tennis", "the PGA and LPGA tours, the majors, and the ATP and WTA tours"),
];

export const NEWS_TOPIC_GROUPS: readonly NewsTopicGroup[] = ["Technology", "Business", "World and society", "Pop culture", "Sports"];

const BY_ID = new Map(NEWS_TOPICS.map((x) => [x.id, x] as const));

export function newsTopic(id: string): NewsTopic | undefined {
  return BY_ID.get(id);
}

/**
 * A customer's saved choice, cleaned: only ids on the list, each once, in the list's order. Anything
 * else is dropped — including the free-text topics saved before October 2026, which the customer
 * re-picks from the list.
 */
export function chosenTopicIds(saved: readonly string[]): string[] {
  const want = new Set(saved);
  return NEWS_TOPICS.filter((x) => want.has(x.id)).map((x) => x.id);
}

/** Which edition an account reads. Only the US edition exists yet; see the header. */
export function editionFor(_timezone: string): NewsEdition {
  return "us";
}

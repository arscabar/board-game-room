import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { Pool, PoolClient } from "pg";
import type {
  LeaderboardEntry,
  MatchRecord,
  PlayerGameStats,
  PlayerStatsResponse,
  StatsSummary
} from "../src/shared/stats";

const { Pool: PgPool } = pg;

type StatsData = {
  matches: MatchRecord[];
  playerStats: PlayerGameStats[];
};

type StatsStore = {
  init: () => Promise<void>;
  recordMatch: (match: MatchRecord) => Promise<void>;
  getLeaderboard: (gameId: string | null, limit: number) => Promise<LeaderboardEntry[]>;
  getPlayerStats: (playerName: string, limit: number) => Promise<PlayerStatsResponse>;
  getRecentMatches: (limit: number) => Promise<MatchRecord[]>;
  getSummary: () => Promise<StatsSummary>;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_STATS_FILE = path.resolve(__dirname, "../data/stats.json");

function createEmptyData(): StatsData {
  return {
    matches: [],
    playerStats: []
  };
}

export function normalizePlayerKey(name: string) {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");
}

function toNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function withDerivedStats(entry: PlayerGameStats): LeaderboardEntry {
  return {
    ...entry,
    winRate: entry.gamesPlayed > 0 ? entry.wins / entry.gamesPlayed : 0,
    averageScore: entry.scoredGames > 0 ? entry.totalScore / entry.scoredGames : null
  };
}

function sortLeaderboard(entries: LeaderboardEntry[]) {
  return [...entries].sort((a, b) => {
    if (b.winRate !== a.winRate) return b.winRate - a.winRate;
    if (b.wins !== a.wins) return b.wins - a.wins;
    const aHigh = a.highScore ?? Number.NEGATIVE_INFINITY;
    const bHigh = b.highScore ?? Number.NEGATIVE_INFINITY;
    if (bHigh !== aHigh) return bHigh - aHigh;
    if (b.gamesPlayed !== a.gamesPlayed) return b.gamesPlayed - a.gamesPlayed;
    return a.playerName.localeCompare(b.playerName, "ko-KR");
  });
}

function aggregateEntries(entries: PlayerGameStats[]) {
  const grouped = new Map<string, PlayerGameStats>();
  for (const entry of entries) {
    const existing = grouped.get(entry.playerKey);
    if (!existing) {
      grouped.set(entry.playerKey, {
        ...entry,
        gameId: "all",
        gameTitle: "전체 게임"
      });
      continue;
    }

    existing.gamesPlayed += entry.gamesPlayed;
    existing.wins += entry.wins;
    existing.losses += entry.losses;
    existing.draws += entry.draws;
    existing.totalScore += entry.totalScore;
    existing.scoredGames += entry.scoredGames;
    existing.highScore =
      existing.highScore === null
        ? entry.highScore
        : entry.highScore === null
          ? existing.highScore
          : Math.max(existing.highScore, entry.highScore);
    if (entry.lastPlayedAt > existing.lastPlayedAt) {
      existing.playerName = entry.playerName;
      existing.lastPlayedAt = entry.lastPlayedAt;
    }
  }
  return [...grouped.values()];
}

function leaderboardFrom(entries: PlayerGameStats[], gameId: string | null, limit: number) {
  const scoped = gameId ? entries.filter((entry) => entry.gameId === gameId) : aggregateEntries(entries);
  return sortLeaderboard(scoped.map(withDerivedStats)).slice(0, limit);
}

function incrementStats(existing: PlayerGameStats | undefined, match: MatchRecord, player: MatchRecord["players"][number]) {
  const win = player.result === "win" ? 1 : 0;
  const loss = player.result === "loss" ? 1 : 0;
  const draw = player.result === "draw" ? 1 : 0;
  const scored = player.score === null ? 0 : 1;
  const score = player.score ?? 0;

  if (!existing) {
    return {
      playerKey: player.playerKey,
      playerName: player.playerName,
      gameId: match.gameId,
      gameTitle: match.gameTitle,
      gamesPlayed: 1,
      wins: win,
      losses: loss,
      draws: draw,
      totalScore: score,
      scoredGames: scored,
      highScore: player.score,
      lastPlayedAt: match.finishedAt
    } satisfies PlayerGameStats;
  }

  return {
    ...existing,
    playerName: player.playerName,
    gameTitle: match.gameTitle,
    gamesPlayed: existing.gamesPlayed + 1,
    wins: existing.wins + win,
    losses: existing.losses + loss,
    draws: existing.draws + draw,
    totalScore: existing.totalScore + score,
    scoredGames: existing.scoredGames + scored,
    highScore:
      player.score === null
        ? existing.highScore
        : existing.highScore === null
          ? player.score
          : Math.max(existing.highScore, player.score),
    lastPlayedAt: Math.max(existing.lastPlayedAt, match.finishedAt)
  } satisfies PlayerGameStats;
}

class JsonStatsStore implements StatsStore {
  private writeChain = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      await fs.access(this.filePath);
    } catch {
      await this.writeData(createEmptyData());
    }
  }

  async recordMatch(match: MatchRecord) {
    await this.updateData((data) => {
      if (data.matches.some((item) => item.id === match.id)) {
        return;
      }

      data.matches.unshift(match);
      data.matches = data.matches.slice(0, 500);

      for (const player of match.players) {
        const index = data.playerStats.findIndex(
          (entry) => entry.playerKey === player.playerKey && entry.gameId === match.gameId
        );
        data.playerStats[index === -1 ? data.playerStats.length : index] = incrementStats(data.playerStats[index], match, player);
      }
    });
  }

  async getLeaderboard(gameId: string | null, limit: number) {
    const data = await this.readData();
    return leaderboardFrom(data.playerStats, gameId, limit);
  }

  async getPlayerStats(playerName: string, limit: number) {
    const playerKey = normalizePlayerKey(playerName);
    const data = await this.readData();
    const entries = sortLeaderboard(
      data.playerStats.filter((entry) => entry.playerKey === playerKey).map(withDerivedStats)
    );
    const displayName = entries[0]?.playerName ?? playerName.trim();
    const recentMatches = data.matches
      .filter((match) => match.players.some((player) => player.playerKey === playerKey))
      .slice(0, limit);

    return { playerName: displayName, entries, recentMatches };
  }

  async getRecentMatches(limit: number) {
    const data = await this.readData();
    return data.matches.slice(0, limit);
  }

  async getSummary() {
    const data = await this.readData();
    const players = new Set(data.playerStats.map((entry) => entry.playerKey));
    const games = new Map<string, { gameId: string; gameTitle: string; matches: number; playerEntries: number }>();
    for (const match of data.matches) {
      const current = games.get(match.gameId) ?? {
        gameId: match.gameId,
        gameTitle: match.gameTitle,
        matches: 0,
        playerEntries: 0
      };
      current.matches += 1;
      games.set(match.gameId, current);
    }
    for (const entry of data.playerStats) {
      const current = games.get(entry.gameId) ?? {
        gameId: entry.gameId,
        gameTitle: entry.gameTitle,
        matches: 0,
        playerEntries: 0
      };
      current.playerEntries += 1;
      games.set(entry.gameId, current);
    }

    return {
      totalMatches: data.matches.length,
      totalPlayers: players.size,
      games: [...games.values()].sort((a, b) => b.matches - a.matches || a.gameTitle.localeCompare(b.gameTitle, "ko-KR"))
    };
  }

  private async updateData(mutator: (data: StatsData) => void) {
    this.writeChain = this.writeChain.then(async () => {
      const data = await this.readData();
      mutator(data);
      await this.writeData(data);
    });
    await this.writeChain;
  }

  private async readData(): Promise<StatsData> {
    try {
      const text = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(text) as Partial<StatsData>;
      return {
        matches: Array.isArray(parsed.matches) ? parsed.matches : [],
        playerStats: Array.isArray(parsed.playerStats) ? parsed.playerStats : []
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return createEmptyData();
      }
      throw error;
    }
  }

  private async writeData(data: StatsData) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }
}

class PostgresStatsStore implements StatsStore {
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    const sslMode = process.env.DATABASE_SSL?.trim().toLowerCase();
    const ssl =
      sslMode === "false"
        ? undefined
        : sslMode === "true" || databaseUrl.includes("sslmode=require") || databaseUrl.includes("supabase.")
          ? { rejectUnauthorized: false }
          : undefined;
    this.pool = new PgPool({ connectionString: databaseUrl, ssl }) as Pool;
  }

  async init() {
    await this.pool.query(`
      create table if not exists board_game_matches (
        id text primary key,
        game_id text not null,
        game_title text not null,
        room_code text not null,
        started_at bigint,
        finished_at bigint not null,
        duration_ms bigint,
        winner_ids text[] not null default '{}',
        payload jsonb not null
      );
    `);
    await this.pool.query(`
      create table if not exists board_game_player_stats (
        player_key text not null,
        player_name text not null,
        game_id text not null,
        game_title text not null,
        games_played integer not null default 0,
        wins integer not null default 0,
        losses integer not null default 0,
        draws integer not null default 0,
        total_score double precision not null default 0,
        scored_games integer not null default 0,
        high_score double precision,
        last_played_at bigint not null,
        primary key (player_key, game_id)
      );
    `);
    await this.pool.query("create index if not exists board_game_matches_finished_at_idx on board_game_matches (finished_at desc);");
    await this.pool.query("create index if not exists board_game_player_stats_game_idx on board_game_player_stats (game_id);");
  }

  async recordMatch(match: MatchRecord) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const inserted = await client.query<{ id: string }>(
        `
          insert into board_game_matches
            (id, game_id, game_title, room_code, started_at, finished_at, duration_ms, winner_ids, payload)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          on conflict (id) do nothing
          returning id
        `,
        [
          match.id,
          match.gameId,
          match.gameTitle,
          match.roomCode,
          match.startedAt,
          match.finishedAt,
          match.durationMs,
          match.winnerIds,
          JSON.stringify(match)
        ]
      );
      if (inserted.rowCount === 0) {
        await client.query("commit");
        return;
      }

      for (const player of match.players) {
        await this.upsertPlayerStats(client, match, player);
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async getLeaderboard(gameId: string | null, limit: number) {
    const entries = await this.getStatsRows(gameId);
    return leaderboardFrom(entries, gameId, limit);
  }

  async getPlayerStats(playerName: string, limit: number) {
    const playerKey = normalizePlayerKey(playerName);
    const statsResult = await this.pool.query("select * from board_game_player_stats where player_key = $1", [playerKey]);
    const entries = sortLeaderboard(statsResult.rows.map(rowToStats).map(withDerivedStats));
    const matchesResult = await this.pool.query<{ payload: MatchRecord }>(
      `
        select payload
        from board_game_matches
        where payload->'players' @> $1::jsonb
        order by finished_at desc
        limit $2
      `,
      [JSON.stringify([{ playerKey }]), limit]
    );
    return {
      playerName: entries[0]?.playerName ?? playerName.trim(),
      entries,
      recentMatches: matchesResult.rows.map((row) => row.payload)
    };
  }

  async getRecentMatches(limit: number) {
    const result = await this.pool.query<{ payload: MatchRecord }>(
      "select payload from board_game_matches order by finished_at desc limit $1",
      [limit]
    );
    return result.rows.map((row) => row.payload);
  }

  async getSummary() {
    const [matchCount, playerCount, games] = await Promise.all([
      this.pool.query<{ count: string }>("select count(*)::text as count from board_game_matches"),
      this.pool.query<{ count: string }>("select count(distinct player_key)::text as count from board_game_player_stats"),
      this.pool.query<{
        game_id: string;
        game_title: string;
        matches: string;
        player_entries: string;
      }>(`
        select
          coalesce(m.game_id, s.game_id) as game_id,
          coalesce(m.game_title, s.game_title) as game_title,
          coalesce(m.matches, 0)::text as matches,
          coalesce(s.player_entries, 0)::text as player_entries
        from (
          select game_id, game_title, count(*) as matches
          from board_game_matches
          group by game_id, game_title
        ) m
        full outer join (
          select game_id, game_title, count(*) as player_entries
          from board_game_player_stats
          group by game_id, game_title
        ) s on s.game_id = m.game_id
        order by coalesce(m.matches, 0) desc, coalesce(m.game_title, s.game_title) asc
      `)
    ]);

    return {
      totalMatches: toNumber(matchCount.rows[0]?.count),
      totalPlayers: toNumber(playerCount.rows[0]?.count),
      games: games.rows.map((row) => ({
        gameId: row.game_id,
        gameTitle: row.game_title,
        matches: toNumber(row.matches),
        playerEntries: toNumber(row.player_entries)
      }))
    };
  }

  private async getStatsRows(gameId: string | null) {
    const result = gameId
      ? await this.pool.query("select * from board_game_player_stats where game_id = $1", [gameId])
      : await this.pool.query("select * from board_game_player_stats");
    return result.rows.map(rowToStats);
  }

  private async upsertPlayerStats(client: PoolClient, match: MatchRecord, player: MatchRecord["players"][number]) {
    const win = player.result === "win" ? 1 : 0;
    const loss = player.result === "loss" ? 1 : 0;
    const draw = player.result === "draw" ? 1 : 0;
    const score = player.score ?? 0;
    const scored = player.score === null ? 0 : 1;

    await client.query(
      `
        insert into board_game_player_stats
          (player_key, player_name, game_id, game_title, games_played, wins, losses, draws, total_score, scored_games, high_score, last_played_at)
        values ($1, $2, $3, $4, 1, $5, $6, $7, $8, $9, $10, $11)
        on conflict (player_key, game_id) do update set
          player_name = excluded.player_name,
          game_title = excluded.game_title,
          games_played = board_game_player_stats.games_played + excluded.games_played,
          wins = board_game_player_stats.wins + excluded.wins,
          losses = board_game_player_stats.losses + excluded.losses,
          draws = board_game_player_stats.draws + excluded.draws,
          total_score = board_game_player_stats.total_score + excluded.total_score,
          scored_games = board_game_player_stats.scored_games + excluded.scored_games,
          high_score = case
            when excluded.high_score is null then board_game_player_stats.high_score
            when board_game_player_stats.high_score is null then excluded.high_score
            else greatest(board_game_player_stats.high_score, excluded.high_score)
          end,
          last_played_at = greatest(board_game_player_stats.last_played_at, excluded.last_played_at)
      `,
      [
        player.playerKey,
        player.playerName,
        match.gameId,
        match.gameTitle,
        win,
        loss,
        draw,
        score,
        scored,
        player.score,
        match.finishedAt
      ]
    );
  }
}

function rowToStats(row: Record<string, unknown>): PlayerGameStats {
  return {
    playerKey: String(row.player_key ?? ""),
    playerName: String(row.player_name ?? ""),
    gameId: String(row.game_id ?? ""),
    gameTitle: String(row.game_title ?? ""),
    gamesPlayed: toNumber(row.games_played),
    wins: toNumber(row.wins),
    losses: toNumber(row.losses),
    draws: toNumber(row.draws),
    totalScore: toNumber(row.total_score),
    scoredGames: toNumber(row.scored_games),
    highScore: row.high_score === null || row.high_score === undefined ? null : toNumber(row.high_score),
    lastPlayedAt: toNumber(row.last_played_at)
  };
}

export function createStatsStore(): StatsStore {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl) {
    return new PostgresStatsStore(databaseUrl);
  }

  const filePath = process.env.STATS_FILE?.trim() || DEFAULT_STATS_FILE;
  return new JsonStatsStore(path.resolve(filePath));
}

export function createMatchId(roomCode: string, gameId: string, startedAt: number | null) {
  return `${roomCode}-${gameId}-${startedAt ?? randomUUID()}`;
}

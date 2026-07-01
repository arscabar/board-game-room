export type MatchResult = "win" | "loss" | "draw";

export interface MatchPlayerRecord {
  playerId: string;
  playerKey: string;
  playerName: string;
  score: number | null;
  result: MatchResult;
}

export interface MatchRecord {
  id: string;
  gameId: string;
  gameTitle: string;
  roomCode: string;
  startedAt: number | null;
  finishedAt: number;
  durationMs: number | null;
  winnerIds: string[];
  players: MatchPlayerRecord[];
}

export interface PlayerGameStats {
  playerKey: string;
  playerName: string;
  gameId: string;
  gameTitle: string;
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  totalScore: number;
  scoredGames: number;
  highScore: number | null;
  lastPlayedAt: number;
}

export interface LeaderboardEntry extends PlayerGameStats {
  winRate: number;
  averageScore: number | null;
}

export interface PlayerStatsResponse {
  playerName: string;
  entries: LeaderboardEntry[];
  recentMatches: MatchRecord[];
}

export interface GameStatsSummary {
  gameId: string;
  gameTitle: string;
  matches: number;
  playerEntries: number;
}

export interface StatsSummary {
  totalMatches: number;
  totalPlayers: number;
  games: GameStatsSummary[];
}

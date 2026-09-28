export type CommandType = 'CLOSE_ALL' | 'OPEN_TRADE' | 'CLOSE_POSITION' | 'SET_SLTP';

export interface Command {
  id: string;
  type: CommandType;
  createdAt: number;
  accountId: string;
  userId: string;
  // OPEN_TRADE fields
  symbol?: string;
  action?: 'BUY' | 'SELL';
  volume?: number;
  // Which kind of order. 'market' fills now; 'limit' waits for the price to
  // come back to it; 'stop' waits for the price to break through it. The EA
  // cannot tell a limit from a stop by the price alone — above or below the
  // market means the opposite thing for each — so it is said outright.
  orderType?: 'market' | 'limit' | 'stop';
  price?: number;   // 0 = market order, otherwise the pending order's price
  sl?: number;
  tp?: number;
  /**
   * A stop or target given as a distance in points instead of a price.
   *
   * Carried as a distance the whole way so the EA can measure it from the
   * price the order actually gets. Worked out into a price anywhere before
   * that and it is measured against a quote the market has already left —
   * which on a twenty-point stop is the difference between a valid order
   * and one the broker refuses.
   */
  slPoints?: number;
  tpPoints?: number;
  comment?: string;
  // CLOSE_POSITION / SET_SLTP fields
  ticket?: number;
}

// Map<apiKey, Command[]>
const queue = new Map<string, Command[]>();

let cmdCounter = 0;

export const commandQueue = {
  /** Enqueue a command for a specific apiKey. */
  enqueue(apiKey: string, command: Omit<Command, 'id' | 'createdAt'>): Command {
    const cmd: Command = {
      ...command,
      id: `cmd_${Date.now()}_${++cmdCounter}`,
      createdAt: Date.now(),
    };
    const existing = queue.get(apiKey) || [];
    existing.push(cmd);
    queue.set(apiKey, existing);
    console.log(
      `[CmdQueue] Enqueued ${cmd.type} for apiKey ...${apiKey.slice(-6)} (id: ${cmd.id})`,
    );
    return cmd;
  },

  /** Drain (dequeue) all pending commands for an apiKey. */
  drain(apiKey: string): Command[] {
    const commands = queue.get(apiKey) || [];
    if (commands.length > 0) {
      queue.delete(apiKey);
      console.log(
        `[CmdQueue] Drained ${commands.length} commands for apiKey ...${apiKey.slice(-6)}`,
      );
    }
    return commands;
  },

  /** Check if there are pending commands without draining. */
  hasPending(apiKey: string): boolean {
    return (queue.get(apiKey)?.length ?? 0) > 0;
  },

  /** Remove all commands for an apiKey (e.g. if account is deleted). */
  clear(apiKey: string): void {
    queue.delete(apiKey);
  },
};

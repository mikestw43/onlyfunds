/**
 * Which EA build an account is running, and what to tell someone whose
 * command it will not carry out.
 *
 * From v1.4 the EA ships as two builds from one source: "Report with AI",
 * which executes commands once EnableTrading is on, and "Report Only",
 * which has no trading code compiled into it at all. They are told apart
 * by the version string the EA reports on every push.
 *
 * The distinction has to reach the message, because the advice differs and
 * one of them is a dead end: telling someone running Report Only to "set
 * EnableTrading = true on its chart" sends them looking for an input that
 * build does not have. It has to say: install the other one.
 */

/** True for the build with no trading code in it. */
export const isReportOnlyBuild = (eaVersion?: string | null): boolean =>
  typeof eaVersion === 'string' && eaVersion.endsWith('-report');

/**
 * Why a command will not be carried out, or null if it will be.
 *
 * `canExecute` is what the EA itself said on its last push, so this is the
 * terminal's own answer rather than a guess from the version string.
 */
export const executionRefusal = (
  account: { canExecute?: boolean; eaVersion?: string | null }
): string | null => {
  if (account.canExecute) return null;
  if (isReportOnlyBuild(account.eaVersion)) {
    return 'This account runs the Report Only build of the EA, which has no ' +
      'trading code in it. Install "OnlyFunds Report with AI" on its chart ' +
      'instead — there is no setting on this one that will turn trading on.';
  }
  if (account.eaVersion) {
    return 'Trading is switched off in the EA on this account. Set ' +
      'EnableTrading = true on its chart in MT5.';
  }
  return 'The EA on this account only reports. Update it to the version that ' +
    'carries out orders.';
};

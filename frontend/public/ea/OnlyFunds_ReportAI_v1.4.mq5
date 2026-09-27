//+------------------------------------------------------------------+
//| OnlyFunds Report with AI v1.4                                    |
//|                                                                  |
//| GENERATED FILE - do not edit.                                    |
//| Source: ea/OnlyFunds_Reporter_v1.4.mq5                           |
//| Rebuild: python3 scripts/build-ea-variants.py                    |
//+------------------------------------------------------------------+
// Reports this account AND carries out the orders the dashboard
// sends, once you set EnableTrading = true on its chart. Start
// it on a demo account.

#define ONLYFUNDS_AI 1

//+------------------------------------------------------------------+
//|                                      OnlyFunds_Reporter_v1.4.mq5 |
//|                         OnlyFunds MT5 Dashboard EA               |
//|                                                                  |
//| v1.4 — two things the assistant needs to be useful with money:   |
//|                                                                  |
//|        • PARTIAL CLOSE. "Close half of it" was impossible: v1.3  |
//|          could only close a position whole. A CLOSE_POSITION now |
//|          may carry a volume, and anything smaller than the       |
//|          position closes that much of it.                        |
//|                                                                  |
//|        • SYMBOL SPECS. The dashboard had no idea that XAGUSD is  |
//|          5,000 ounces a lot and XAUUSD is 100, or what a point   |
//|          is worth on either — so anything it said about risk was |
//|          a guess, and a guess is worse than silence when it is   |
//|          about lot sizes. This sends the numbers the terminal    |
//|          already knows: contract size, tick value and size, the  |
//|          volume steps, the broker's minimum stop distance, the   |
//|          live bid and ask, and a 14-day ATR for comparing one    |
//|          instrument's movement with another's.                   |
//|          Sent for the symbols actually in use — held, pending,   |
//|          or named in SpecSymbols — every SpecsMinutes.           |
//|                                                                  |
//| v1.3 — carries out the commands the dashboard sends: open, close,|
//|        set SL/TP, close all. Until now the server queued them    |
//|        and nothing on this side ever looked.                     |
//|                                                                  |
//|        TRADING IS OFF UNTIL YOU TURN IT ON. EnableTrading is     |
//|        false by default, and while it is false this EA behaves   |
//|        exactly like v1.2: it reports and touches nothing. The    |
//|        server is told on every push whether this EA will execute,|
//|        so it never hands commands to one that will not.          |
//|                                                                  |
//|        The limits below are the last line: they live in the      |
//|        terminal, not on the server, so a wrong or compromised    |
//|        server still cannot make this EA place a 10-lot order.    |
//|                                                                  |
//| v1.2 — sends the broker's symbol list, so the dashboard's NEW    |
//|        TRADE box can search it. The server never had any way to  |
//|        know what this broker offers: it only ever saw symbols    |
//|        that were already traded. Sent on the first push and      |
//|        every SymbolListMinutes after — a few hundred names that  |
//|        do not change between ticks.                              |
//|                                                                  |
//|        STILL REPORT-ONLY. This EA does not place, modify or      |
//|        close anything. It reads the terminal and posts what it   |
//|        finds. Orders sent from the dashboard are queued by the   |
//|        server and wait for a future version that executes them.  |
//|                                                                  |
//| v1.1 — all clock reads moved from TimeCurrent() to the terminal's|
//|        server clock. See ServerNow() below: with the market shut |
//|        TimeCurrent() stops moving, which silently stopped the    |
//|        EA from pushing and skewed the broker offset by ~40h.     |
//|                                                                  |
//| v1.0 — first release under the OnlyFunds name. Numbering starts  |
//|        over here; the reporter logic is the one that shipped as  |
//|        v1.3 of the previous EA:                                  |
//|                                                                  |
//|   • today_pl is computed on the EA side and sent as one trusted  |
//|     number, so the backend never reconstructs TODAY P/L from     |
//|     stored deals — that used to miss trades closed while the EA  |
//|     was offline. Matches MT5 history exactly.                    |
//|   • Only BUY/SELL deals count toward today_pl; BALANCE, CREDIT   |
//|     and BONUS operations are excluded so they cannot inflate it. |
//|   • Floating P/L = equity - balance - credit, subtracting credit |
//|     explicitly so promotional bonuses don't leak through.        |
//|   • Pushes closedDeals[] for the trade-history page, plus        |
//|     brokerTimeOffset.                                            |
//+------------------------------------------------------------------+
//+------------------------------------------------------------------+
//|  WHICH BUILD IS THIS                                             |
//|                                                                  |
//|  Two EAs come out of this one file, built by                     |
//|  scripts/build-ea-variants.py:                                   |
//|                                                                  |
//|    ONLYFUNDS_AI defined -> "OnlyFunds Report with AI"            |
//|        Reports, and carries out dashboard commands once          |
//|        EnableTrading is switched on.                             |
//|                                                                  |
//|    not defined          -> "OnlyFunds Report Only"               |
//|        The trading code is not compiled into it at all. There is |
//|        no switch to find, and no server, no command and no       |
//|        mistake can make this build place an order. That is a     |
//|        stronger promise than a setting left off, which is the    |
//|        point of having two: the reporter goes on the live        |
//|        accounts where the real EAs are working.                  |
//|                                                                  |
//|  Edit THIS file. The two generated ones are overwritten.         |
//+------------------------------------------------------------------+
#property copyright "OnlyFunds"
#property version   "1.4"
#ifdef ONLYFUNDS_AI
#property description "OnlyFunds Report with AI v1.4: reports the account, and carries out dashboard commands when EnableTrading is on"
#else
#property description "OnlyFunds Report Only v1.4: reports the account. The trading code is not in this build - it cannot place an order."
#endif

//--- Named once, so the log line, the banner and the eaVersion the server
//--- reads cannot drift apart the way "v1.2"/"v1.3" did in this file.
#ifdef ONLYFUNDS_AI
const string OF_BUILD = "1.4-ai";
#else
const string OF_BUILD = "1.4-report";
#endif

#ifdef ONLYFUNDS_AI
#include <Trade/Trade.mqh>
CTrade g_trade;
#endif

//--- Input Parameters
input string   ApiKey         = "";           // API Key * (get from Dashboard → Accounts)
input string   ServerURL      = "https://onlyfunds.duckdns.org"; // Server URL
input int      UpdateInterval = 2;            // Update interval (seconds)
input int      SymbolListMinutes = 60;        // Re-send the broker's symbol list every N minutes
input bool     MarketWatchOnly = false;       // true = only symbols in Market Watch
input bool     VerboseLog      = true;        // Write every decision to the Experts log

#ifdef ONLYFUNDS_AI
//--- Trading (all of this is off until you say otherwise)
input group    "=== Trading — read before switching on ==="
input bool     EnableTrading      = false;    // MASTER SWITCH. false = report only, exactly like v1.2
input double   MaxLotsPerOrder    = 0.10;     // Refuse any order larger than this, whatever the server says
input int      MaxOrdersPerHour   = 10;       // Refuse more than this many executions in a rolling hour
input string   AllowedSymbols     = "";       // "" = any. Otherwise a list: "XAUUSD.v,EURUSD"
input int      CommandMaxAgeSec   = 60;       // Ignore a command older than this (the price has moved on)
input bool     AllowManageForeign = true;     // Close/modify positions opened by other EAs on this account
input string   ForeignMagicBlock  = "";       // Magic numbers this EA must never touch: "12345,67890"
input bool     AllowCloseAll      = true;     // Allow the dashboard's CLOSE ALL button
input int      MagicNumber        = 990001;   // Stamped on orders opened from the dashboard
input int      MaxSlippagePoints  = 20;       // Deviation allowed when filling
input int      RetryCount         = 2;        // Retries on requote / price change
#else
//--- Report Only build. Nothing reads this but the lines that report the
//--- build's own state; there is no trading code here to switch on.
const bool     EnableTrading      = false;
#endif

input group    "=== What the dashboard is told about symbols ==="
input int      SpecsMinutes       = 5;        // Re-send contract specs and ATR every N minutes (0 = off)
input string   SpecSymbols        = "";       // Extra symbols to send specs for: "XAGUSD,EURUSD"
input int      SpecsMaxSymbols    = 25;       // Never send more than this many, whatever is open

//--- Globals
datetime g_lastSend       = 0;
datetime g_lastSpecSend   = 0;
bool     g_initDone       = false;
datetime g_lastDealTime   = 0;   // Watermark for closedDeals push
int      g_backfillCount  = 0;
datetime g_lastSymbolSend = 0;   // When the symbol list last went out

#ifdef ONLYFUNDS_AI
//--- Commands already carried out, so a repeat delivery cannot run twice.
string   g_doneIds[];
datetime g_doneAt[];
//--- Executions in the last hour, for MaxOrdersPerHour.
datetime g_execAt[];
//--- Results waiting to be reported back to the server.
string   g_ackJson = "";
int      g_ackCount = 0;
#endif

#define SYMBOL_LIMIT 2000

#define BACKFILL_PUSHES 5

//+------------------------------------------------------------------+
int OnInit()
{
   if(ApiKey == "")
   {
      Alert("OnlyFunds: กรุณาตั้งค่า API Key ก่อนใช้งาน");
      return INIT_PARAMETERS_INCORRECT;
   }

   g_lastDealTime = BrokerMidnight();

   EventSetTimer(1);
   Print("OnlyFunds Reporter ", OF_BUILD, " started | Account: ", AccountInfoInteger(ACCOUNT_LOGIN));
   Print("  Server: ", ServerURL);
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   EventKillTimer();
   Print("OnlyFunds Reporter stopped.");
}

//+------------------------------------------------------------------+
void OnTimer()
{
   if(ServerNow() - g_lastSend < UpdateInterval) return;
   g_lastSend = ServerNow();
   SendData();
}

//+------------------------------------------------------------------+
//  Helpers
//+------------------------------------------------------------------+
string EscapeJson(string text)
{
   StringReplace(text, "\\", "\\\\");
   StringReplace(text, "\"", "\\\"");
   StringReplace(text, "\n", "\\n");
   StringReplace(text, "\r", "\\r");
   return text;
}

//+------------------------------------------------------------------+
//  Current server time.
//
//  TimeCurrent() is the timestamp of the LAST TICK, so it freezes solid
//  whenever the market is closed — over a weekend it can sit ~40 hours
//  behind. That broke two things at once: the send throttle below never
//  saw time move, so the EA pushed once and then went quiet (the
//  dashboard marked the account offline after 30s), and the broker
//  offset came out as nonsense like -142329s.
//
//  TimeTradeServer() is the terminal's own running clock for the server,
//  so it keeps ticking with no quotes. Fall back to TimeCurrent() on the
//  rare startup where the terminal has not resolved the offset yet.
//+------------------------------------------------------------------+
datetime ServerNow()
{
   datetime t = TimeTradeServer();
   return (t > 0) ? t : TimeCurrent();
}

datetime BrokerMidnight()
{
   return StringToTime(TimeToString(ServerNow(), TIME_DATE) + " 00:00:00");
}

long BrokerTimeOffsetSec()
{
   return (long)(ServerNow() - TimeGMT());
}

bool IsClosingEntry(long entry)
{
   return entry == DEAL_ENTRY_OUT
       || entry == DEAL_ENTRY_OUT_BY
       || entry == DEAL_ENTRY_INOUT;
}

//+------------------------------------------------------------------+
//  Compute today's net P/L directly from MT5 deal history.
//  Returns the same number MT5's "History" view shows under "Profit"
//  for today's deals (excluding balance/credit/bonus operations).
//+------------------------------------------------------------------+
double ComputeTodayPl(int &closedCount)
{
   closedCount = 0;
   double todayPl = 0;

   datetime todayStart = BrokerMidnight();
   if(!HistorySelect(todayStart, ServerNow() + 1)) return 0;

   int total = HistoryDealsTotal();
   for(int i = 0; i < total; i++)
   {
      ulong ticket = HistoryDealGetTicket(i);
      if(ticket == 0) continue;

      long dealType  = HistoryDealGetInteger(ticket, DEAL_TYPE);
      long dealEntry = HistoryDealGetInteger(ticket, DEAL_ENTRY);

      // Trading-only deals (skip BALANCE, CREDIT, BONUS, INTEREST, etc.)
      if(dealType != DEAL_TYPE_BUY && dealType != DEAL_TYPE_SELL) continue;

      // Only closing entries contribute realized P/L
      if(!IsClosingEntry(dealEntry)) continue;

      todayPl += HistoryDealGetDouble(ticket, DEAL_PROFIT)
              +  HistoryDealGetDouble(ticket, DEAL_SWAP)
              +  HistoryDealGetDouble(ticket, DEAL_COMMISSION);
      closedCount++;
   }

   return todayPl;
}

//+------------------------------------------------------------------+
//  Build closedDeals JSON for the trade-history page (separate from
//  today_pl, which is the authoritative number for "TODAY" display).
//  Uses the same robust two-pass pattern as v1.2.
//+------------------------------------------------------------------+
string BuildClosedDealsJson()
{
   bool     isBackfill     = g_backfillCount < BACKFILL_PUSHES;
   datetime brokerMidnight = BrokerMidnight();
   datetime fromTime       = isBackfill ? brokerMidnight : (datetime)(g_lastDealTime - 5);
   datetime toTime         = ServerNow();

   if(!HistorySelect(fromTime, toTime)) return "[]";

   // Pass 1: collect closing deals
   ulong    a_ticket[];
   long     a_posId[];
   string   a_sym[];
   double   a_lots[], a_closePrice[], a_profit[], a_swap[], a_commission[];
   datetime a_time[];

   int total = HistoryDealsTotal();
   for(int i = 0; i < total; i++)
   {
      ulong ticket = HistoryDealGetTicket(i);
      if(ticket == 0) continue;

      long dealType  = HistoryDealGetInteger(ticket, DEAL_TYPE);
      long dealEntry = HistoryDealGetInteger(ticket, DEAL_ENTRY);
      if(dealType != DEAL_TYPE_BUY && dealType != DEAL_TYPE_SELL) continue;
      if(!IsClosingEntry(dealEntry)) continue;

      datetime dealTime = (datetime)HistoryDealGetInteger(ticket, DEAL_TIME);
      if(isBackfill) {
         if(dealTime < brokerMidnight) continue;
      } else {
         if(dealTime <= g_lastDealTime) continue;
      }

      int n = ArraySize(a_ticket);
      ArrayResize(a_ticket,     n + 1);
      ArrayResize(a_posId,      n + 1);
      ArrayResize(a_sym,        n + 1);
      ArrayResize(a_lots,       n + 1);
      ArrayResize(a_closePrice, n + 1);
      ArrayResize(a_profit,     n + 1);
      ArrayResize(a_swap,       n + 1);
      ArrayResize(a_commission, n + 1);
      ArrayResize(a_time,       n + 1);

      a_ticket[n]     = ticket;
      a_posId[n]      = (long)HistoryDealGetInteger(ticket, DEAL_POSITION_ID);
      a_sym[n]        = HistoryDealGetString(ticket, DEAL_SYMBOL);
      a_lots[n]       = HistoryDealGetDouble(ticket, DEAL_VOLUME);
      a_closePrice[n] = HistoryDealGetDouble(ticket, DEAL_PRICE);
      a_profit[n]     = HistoryDealGetDouble(ticket, DEAL_PROFIT);
      a_swap[n]       = HistoryDealGetDouble(ticket, DEAL_SWAP);
      a_commission[n] = HistoryDealGetDouble(ticket, DEAL_COMMISSION);
      a_time[n]       = dealTime;
   }

   // Pass 2: resolve each position's entry deal
   string  json    = "[";
   int     count   = ArraySize(a_ticket);
   datetime maxSeen = g_lastDealTime;

   for(int i = 0; i < count; i++)
   {
      long     positionId = a_posId[i];
      double   openPrice  = 0;
      datetime openTime   = 0;
      double   entryComm  = 0;
      int      posType    = 0;

      if(HistorySelectByPosition(positionId)) {
         int n = HistoryDealsTotal();
         for(int d = 0; d < n; d++) {
            ulong dt = HistoryDealGetTicket(d);
            if(dt == 0) continue;
            if(HistoryDealGetInteger(dt, DEAL_ENTRY) != DEAL_ENTRY_IN) continue;

            openPrice  = HistoryDealGetDouble(dt, DEAL_PRICE);
            openTime   = (datetime)HistoryDealGetInteger(dt, DEAL_TIME);
            entryComm += HistoryDealGetDouble(dt, DEAL_COMMISSION);
            posType    = (HistoryDealGetInteger(dt, DEAL_TYPE) == DEAL_TYPE_BUY) ? 0 : 1;
         }
      }

      double totalCommission = entryComm + a_commission[i];

      if(i > 0) json += ",";
      json += StringFormat(
         "{\"positionId\":%d,\"ticket\":%d,\"symbol\":\"%s\",\"type\":%d,"
         "\"lots\":%.2f,\"openPrice\":%.5f,\"closePrice\":%.5f,"
         "\"profit\":%.2f,\"swap\":%.2f,\"commission\":%.2f,"
         "\"openTime\":\"%s\",\"closeTime\":\"%s\"}",
         (int)positionId, (int)a_ticket[i], EscapeJson(a_sym[i]), posType,
         a_lots[i], openPrice, a_closePrice[i],
         a_profit[i], a_swap[i], totalCommission,
         TimeToString(openTime,    TIME_DATE|TIME_SECONDS),
         TimeToString(a_time[i],   TIME_DATE|TIME_SECONDS)
      );

      if(a_time[i] > maxSeen) maxSeen = a_time[i];
   }

   if(maxSeen > g_lastDealTime) g_lastDealTime = maxSeen;
   if(isBackfill) g_backfillCount++;

   json += "]";
   return json;
}

//+------------------------------------------------------------------+
//| The broker's symbol list, as a ready-made JSON fragment.         |
//|                                                                  |
//| Returns "" on most calls. The list runs to hundreds of names and |
//| does not change between ticks, so it goes out on the first push  |
//| and every SymbolListMinutes after that; the server keeps the     |
//| last copy and only writes when it actually differs.              |
//+------------------------------------------------------------------+
string BuildSymbolsJson()
{
   datetime now = ServerNow();
   long every = (long)(SymbolListMinutes > 0 ? SymbolListMinutes : 60) * 60;
   if(g_lastSymbolSend != 0 && (long)(now - g_lastSymbolSend) < every)
      return "";

   int total = SymbolsTotal(MarketWatchOnly);
   if(total <= 0) return "";

   string out = "";
   int sent = 0;
   for(int i = 0; i < total && sent < SYMBOL_LIMIT; i++)
   {
      string name = SymbolName(i, MarketWatchOnly);
      if(name == "") continue;
      if(sent > 0) out += ",";
      out += "\"" + EscapeJson(name) + "\"";
      sent++;
   }
   if(sent == 0) return "";

   g_lastSymbolSend = now;
   Print("OnlyFunds: sending ", sent, " symbol names to the dashboard");
   return ",\"symbols\":[" + out + "]";
}


//+------------------------------------------------------------------+
//| A 14-day ATR, worked out from daily bars.                        |
//|                                                                  |
//| Deliberately not iATR: an indicator handle per symbol has to be  |
//| created, waited on and released, and leaking them on a terminal  |
//| that runs for weeks is a real cost for one number. Fifteen daily |
//| bars is one copy and no state.                                   |
//+------------------------------------------------------------------+
double DailyAtr14(const string sym)
{
   MqlRates r[];
   ArraySetAsSeries(r, true);
   int got = CopyRates(sym, PERIOD_D1, 1, 15, r);
   if(got < 2) return 0.0;

   double sum = 0.0;
   int n = 0;
   for(int i = 0; i < got - 1; i++)
   {
      double hl = r[i].high - r[i].low;
      double hc = MathAbs(r[i].high - r[i + 1].close);
      double lc = MathAbs(r[i].low  - r[i + 1].close);
      sum += MathMax(hl, MathMax(hc, lc));
      n++;
      if(n >= 14) break;
   }
   return n > 0 ? sum / n : 0.0;
}

//+------------------------------------------------------------------+
//| Is this symbol already in the list being built?                  |
//+------------------------------------------------------------------+
bool AlreadyListed(const string &list[], const int count, const string sym)
{
   for(int i = 0; i < count; i++) if(list[i] == sym) return true;
   return false;
}

//+------------------------------------------------------------------+
//| What the terminal knows about the symbols in use.                |
//|                                                                  |
//| The dashboard cannot work out risk without these. A lot of gold  |
//| is 100 ounces and a lot of silver is 5,000; a point is worth a   |
//| different amount on each, and on a cent account it is worth a    |
//| hundredth of what it looks like. Anything said about position    |
//| size without these numbers is a guess.                           |
//|                                                                  |
//| Only symbols that matter: held, pending, or named in             |
//| SpecSymbols. Sent every SpecsMinutes — they change rarely, but   |
//| bid and ask do not, so it is not sent once and forgotten.        |
//+------------------------------------------------------------------+
string BuildSpecsJson()
{
   if(SpecsMinutes <= 0) return "";

   datetime now = ServerNow();
   if(g_lastSpecSend != 0 && (long)(now - g_lastSpecSend) < (long)SpecsMinutes * 60)
      return "";

   string names[];
   ArrayResize(names, 0);
   int count = 0;
   int cap = (SpecsMaxSymbols > 0 ? SpecsMaxSymbols : 25);

   // Open positions first — they are what a question is most likely about.
   for(int i = 0; i < PositionsTotal() && count < cap; i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0 || !PositionSelectByTicket(ticket)) continue;
      string sym = PositionGetString(POSITION_SYMBOL);
      if(sym == "" || AlreadyListed(names, count, sym)) continue;
      ArrayResize(names, count + 1); names[count++] = sym;
   }

   // Then anything with an order waiting.
   for(int i = 0; i < OrdersTotal() && count < cap; i++)
   {
      ulong ticket = OrderGetTicket(i);
      if(ticket == 0 || !OrderSelect(ticket)) continue;
      string sym = OrderGetString(ORDER_SYMBOL);
      if(sym == "" || AlreadyListed(names, count, sym)) continue;
      ArrayResize(names, count + 1); names[count++] = sym;
   }

   // Then whatever was asked for by hand.
   if(StringLen(SpecSymbols) > 0)
   {
      string extra[];
      int parts = StringSplit(SpecSymbols, ',', extra);
      for(int i = 0; i < parts && count < cap; i++)
      {
         string sym = extra[i];
         StringTrimLeft(sym); StringTrimRight(sym);
         if(sym == "" || AlreadyListed(names, count, sym)) continue;
         if(!SymbolSelect(sym, true)) continue;
         ArrayResize(names, count + 1); names[count++] = sym;
      }
   }

   if(count == 0) return "";

   string out = "";
   for(int i = 0; i < count; i++)
   {
      string sym = names[i];
      double bid  = SymbolInfoDouble(sym, SYMBOL_BID);
      double ask  = SymbolInfoDouble(sym, SYMBOL_ASK);
      if(bid <= 0 && ask <= 0) continue;

      if(StringLen(out) > 0) out += ",";
      out += StringFormat(
         "{\"symbol\":\"%s\",\"bid\":%.5f,\"ask\":%.5f,\"digits\":%d,\"point\":%.8f,"
         "\"contractSize\":%.2f,\"tickValue\":%.5f,\"tickSize\":%.8f,"
         "\"volMin\":%.2f,\"volMax\":%.2f,\"volStep\":%.2f,\"stopsLevel\":%d,\"atr14\":%.5f}",
         EscapeJson(sym), bid, ask,
         (int)SymbolInfoInteger(sym, SYMBOL_DIGITS),
         SymbolInfoDouble(sym, SYMBOL_POINT),
         SymbolInfoDouble(sym, SYMBOL_TRADE_CONTRACT_SIZE),
         SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_VALUE),
         SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_SIZE),
         SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN),
         SymbolInfoDouble(sym, SYMBOL_VOLUME_MAX),
         SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP),
         (int)SymbolInfoInteger(sym, SYMBOL_TRADE_STOPS_LEVEL),
         DailyAtr14(sym)
      );
   }

   if(StringLen(out) == 0) return "";

   g_lastSpecSend = now;
   if(VerboseLog) Print("OnlyFunds: sending specs for ", count, " symbol(s)");
   return ",\"specs\":[" + out + "]";
}


#ifdef ONLYFUNDS_AI
//+------------------------------------------------------------------+
//|                                                                  |
//|  COMMANDS FROM THE DASHBOARD                                     |
//|                                                                  |
//|  Everything below runs only when EnableTrading is true. With it  |
//|  false this EA never calls a trade function at all, and tells    |
//|  the server so on every push, which stops commands being handed  |
//|  to it in the first place.                                       |
//|                                                                  |
//+------------------------------------------------------------------+

//--- Smallest possible JSON reading. The server's answer has a known
//--- shape, so this looks for the keys it knows rather than parsing
//--- anything in general: a full parser is a lot of code to maintain in
//--- MQL5 for four fields.

// The text between the [ ] that follows "key":
string JsonArrayRaw(string src, string key)
{
   int k = StringFind(src, "\"" + key + "\"");
   if(k < 0) return "";
   int open = StringFind(src, "[", k);
   if(open < 0) return "";

   int depth = 0;
   for(int i = open; i < StringLen(src); i++)
   {
      ushort c = StringGetCharacter(src, i);
      if(c == '[') depth++;
      else if(c == ']')
      {
         depth--;
         if(depth == 0) return StringSubstr(src, open + 1, i - open - 1);
      }
   }
   return "";
}

// Split "{...},{...}" into its objects. Brace-counting, so a nested
// object cannot split one in half.
int JsonObjects(string arr, string &out[])
{
   ArrayResize(out, 0);
   int depth = 0, start = -1;
   for(int i = 0; i < StringLen(arr); i++)
   {
      ushort c = StringGetCharacter(arr, i);
      if(c == '{')
      {
         if(depth == 0) start = i;
         depth++;
      }
      else if(c == '}')
      {
         depth--;
         if(depth == 0 && start >= 0)
         {
            int n = ArraySize(out);
            ArrayResize(out, n + 1);
            out[n] = StringSubstr(arr, start, i - start + 1);
            start = -1;
         }
      }
   }
   return ArraySize(out);
}

// "key":"value" — returns "" when the key is absent
string JsonStr(string obj, string key)
{
   int k = StringFind(obj, "\"" + key + "\"");
   if(k < 0) return "";
   int colon = StringFind(obj, ":", k);
   if(colon < 0) return "";
   int q1 = StringFind(obj, "\"", colon);
   if(q1 < 0) return "";
   int q2 = StringFind(obj, "\"", q1 + 1);
   if(q2 < 0) return "";
   return StringSubstr(obj, q1 + 1, q2 - q1 - 1);
}

// "key":123.45 — returns def when the key is absent
double JsonNum(string obj, string key, double def = 0)
{
   int k = StringFind(obj, "\"" + key + "\"");
   if(k < 0) return def;
   int colon = StringFind(obj, ":", k);
   if(colon < 0) return def;

   string num = "";
   for(int i = colon + 1; i < StringLen(obj); i++)
   {
      ushort c = StringGetCharacter(obj, i);
      if(c == ' ' || c == '\t') { if(num == "") continue; else break; }
      if((c >= '0' && c <= '9') || c == '-' || c == '+' || c == '.' || c == 'e' || c == 'E')
         num += ShortToString(c);
      else break;
   }
   if(num == "") return def;
   return StringToDouble(num);
}

//+------------------------------------------------------------------+
//| Have we run this command already?                                |
//|                                                                  |
//| A delivery can repeat — a dropped answer, a restart — and running |
//| an order twice is the worst thing this EA could do. Ids are kept  |
//| for an hour, which is far longer than any redelivery window.      |
//+------------------------------------------------------------------+
bool AlreadyDone(string id)
{
   datetime now = ServerNow();
   for(int i = ArraySize(g_doneIds) - 1; i >= 0; i--)
   {
      if(now - g_doneAt[i] > 3600)
      {
         // Old enough to forget. Compact by swapping the last one in.
         int last = ArraySize(g_doneIds) - 1;
         g_doneIds[i] = g_doneIds[last];
         g_doneAt[i]  = g_doneAt[last];
         ArrayResize(g_doneIds, last);
         ArrayResize(g_doneAt, last);
         continue;
      }
      if(g_doneIds[i] == id) return true;
   }
   return false;
}

void RememberDone(string id)
{
   int n = ArraySize(g_doneIds);
   ArrayResize(g_doneIds, n + 1);
   ArrayResize(g_doneAt, n + 1);
   g_doneIds[n] = id;
   g_doneAt[n]  = ServerNow();
}

//--- How many executions in the last hour, for MaxOrdersPerHour
int ExecutionsThisHour()
{
   datetime now = ServerNow();
   int kept = 0;
   for(int i = 0; i < ArraySize(g_execAt); i++)
      if(now - g_execAt[i] <= 3600)
      {
         g_execAt[kept] = g_execAt[i];
         kept++;
      }
   ArrayResize(g_execAt, kept);
   return kept;
}

void RememberExecution()
{
   int n = ArraySize(g_execAt);
   ArrayResize(g_execAt, n + 1);
   g_execAt[n] = ServerNow();
}

//--- Collect one result for the report back to the server
void Ack(string id, bool ok, string detail, ulong ticket = 0)
{
   if(g_ackCount > 0) g_ackJson += ",";
   g_ackJson += "{\"id\":\"" + EscapeJson(id) + "\",\"ok\":" + (ok ? "true" : "false");
   if(ticket > 0) g_ackJson += ",\"ticket\":" + IntegerToString((long)ticket);
   if(!ok)        g_ackJson += ",\"error\":\"" + EscapeJson(detail) + "\"";
   g_ackJson += "}";
   g_ackCount++;

   if(VerboseLog)
      Print("OnlyFunds cmd ", id, ok ? " OK: " : " REFUSED: ", detail);
}

//+------------------------------------------------------------------+
//| Is this symbol one we are allowed to trade?                      |
//+------------------------------------------------------------------+
bool SymbolAllowed(string sym)
{
   if(AllowedSymbols == "") return true;
   string list[];
   int n = StringSplit(AllowedSymbols, ',', list);
   for(int i = 0; i < n; i++)
   {
      string one = list[i];
      StringTrimLeft(one);
      StringTrimRight(one);
      if(one == sym) return true;
   }
   return false;
}

//+------------------------------------------------------------------+
//| Is this magic number on the untouchable list?                    |
//|                                                                  |
//| The last safety net, and the one the owner sets themselves: the  |
//| other EAs on this account keep their own books, and a position   |
//| closed behind their back can make them re-enter or miscount.     |
//+------------------------------------------------------------------+
bool MagicBlocked(long magic)
{
   if(ForeignMagicBlock == "") return false;
   string list[];
   int n = StringSplit(ForeignMagicBlock, ',', list);
   for(int i = 0; i < n; i++)
   {
      string one = list[i];
      StringTrimLeft(one);
      StringTrimRight(one);
      if(one != "" && StringToInteger(one) == magic) return true;
   }
   return false;
}

//--- May we touch this open position?
bool MayTouchPosition(ulong ticket, string &why)
{
   if(!PositionSelectByTicket(ticket)) { why = "position not found"; return false; }
   long magic = PositionGetInteger(POSITION_MAGIC);
   if(MagicBlocked(magic)) { why = "magic " + IntegerToString(magic) + " is on the blocked list"; return false; }
   if(magic != MagicNumber && !AllowManageForeign)
   {
      why = "opened by another EA (magic " + IntegerToString(magic) + ") and AllowManageForeign is off";
      return false;
   }
   return true;
}

//--- Can this terminal trade at all right now?
bool TradingPossible(string &why)
{
   if(!EnableTrading)                                   { why = "EnableTrading is off in the EA"; return false; }
   if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED))     { why = "AutoTrading is off in the terminal"; return false; }
   if(!MQLInfoInteger(MQL_TRADE_ALLOWED))               { why = "this EA is not allowed to trade (chart properties)"; return false; }
   if(!AccountInfoInteger(ACCOUNT_TRADE_ALLOWED))       { why = "the broker has trading disabled on this account"; return false; }
   if(!AccountInfoInteger(ACCOUNT_TRADE_EXPERT))        { why = "the broker does not allow EA trading on this account"; return false; }
   if(ExecutionsThisHour() >= MaxOrdersPerHour)         { why = "MaxOrdersPerHour reached"; return false; }
   return true;
}

//+------------------------------------------------------------------+
//| Open a position or place a pending order                         |
//+------------------------------------------------------------------+
void DoOpenTrade(string cmd, string id)
{
   string sym    = JsonStr(cmd, "symbol");
   string action = JsonStr(cmd, "action");
   string kind   = JsonStr(cmd, "orderType");
   double vol    = JsonNum(cmd, "volume");
   double price  = JsonNum(cmd, "price");
   double sl     = JsonNum(cmd, "sl");
   double tp     = JsonNum(cmd, "tp");
   string note   = JsonStr(cmd, "comment");
   if(kind == "") kind = (price > 0 ? "limit" : "market");
   if(note == "") note = "OnlyFunds";

   if(!SymbolAllowed(sym))        { Ack(id, false, sym + " is not in AllowedSymbols"); return; }
   if(vol > MaxLotsPerOrder + 1e-8)
   {
      Ack(id, false, StringFormat("%.2f lots is over MaxLotsPerOrder (%.2f)", vol, MaxLotsPerOrder));
      return;
   }
   if(!SymbolSelect(sym, true))   { Ack(id, false, "this broker has no symbol called " + sym); return; }

   // Round to what the broker will actually accept, and refuse rather than
   // silently trade a different size than was asked for.
   double vmin  = SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN);
   double vmax  = SymbolInfoDouble(sym, SYMBOL_VOLUME_MAX);
   double vstep = SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP);
   if(vstep > 0) vol = MathRound(vol / vstep) * vstep;
   vol = NormalizeDouble(vol, 2);
   if(vol < vmin) { Ack(id, false, StringFormat("%s needs at least %.2f lots", sym, vmin)); return; }
   if(vol > vmax) { Ack(id, false, StringFormat("%s allows at most %.2f lots", sym, vmax)); return; }
   if(vol > MaxLotsPerOrder + 1e-8) { Ack(id, false, "rounded size is over MaxLotsPerOrder"); return; }

   g_trade.SetExpertMagicNumber(MagicNumber);
   g_trade.SetDeviationInPoints(MaxSlippagePoints);
   g_trade.SetTypeFillingBySymbol(sym);

   bool buy = (action == "BUY");
   bool ok  = false;

   for(int attempt = 0; attempt <= RetryCount && !ok; attempt++)
   {
      if(attempt > 0) Sleep(400);

      if(kind == "market")
      {
         ok = buy ? g_trade.Buy(vol, sym, 0.0, sl, tp, note)
                  : g_trade.Sell(vol, sym, 0.0, sl, tp, note);
      }
      else if(kind == "limit")
      {
         ok = buy ? g_trade.BuyLimit(vol, price, sym, sl, tp, ORDER_TIME_GTC, 0, note)
                  : g_trade.SellLimit(vol, price, sym, sl, tp, ORDER_TIME_GTC, 0, note);
      }
      else if(kind == "stop")
      {
         ok = buy ? g_trade.BuyStop(vol, price, sym, sl, tp, ORDER_TIME_GTC, 0, note)
                  : g_trade.SellStop(vol, price, sym, sl, tp, ORDER_TIME_GTC, 0, note);
      }
      else
      {
         Ack(id, false, "unknown order type: " + kind);
         return;
      }

      // Only a requote or a moved price is worth trying again; anything
      // else will fail the same way on the next attempt.
      uint code = g_trade.ResultRetcode();
      if(!ok && code != TRADE_RETCODE_REQUOTE && code != TRADE_RETCODE_PRICE_CHANGED
             && code != TRADE_RETCODE_PRICE_OFF) break;
   }

   if(ok)
   {
      RememberExecution();
      Ack(id, true, "opened", g_trade.ResultOrder());
   }
   else
   {
      Ack(id, false, StringFormat("%u %s", g_trade.ResultRetcode(), g_trade.ResultRetcodeDescription()));
   }
}

//+------------------------------------------------------------------+
//| Close one position by ticket                                      |
//+------------------------------------------------------------------+
void DoClosePosition(string cmd, string id)
{
   ulong ticket = (ulong)JsonNum(cmd, "ticket");
   if(ticket == 0) { Ack(id, false, "no ticket given"); return; }

   // A volume smaller than the position closes part of it. Absent, zero,
   // or anything at least as large as what is held closes the lot — the
   // old behaviour, unchanged, for every command written before v1.4.
   double want = JsonNum(cmd, "volume");

   string why = "";
   if(!MayTouchPosition(ticket, why)) { Ack(id, false, why); return; }

   string sym = PositionGetString(POSITION_SYMBOL);
   g_trade.SetDeviationInPoints(MaxSlippagePoints);
   g_trade.SetTypeFillingBySymbol(sym);

   bool ok = false;
   // What is actually held, so a partial close can be checked against it.
   if(!PositionSelectByTicket(ticket)) { Ack(id, false, "that position is not open any more"); return; }
   string  psym = PositionGetString(POSITION_SYMBOL);
   double  held = PositionGetDouble(POSITION_VOLUME);

   bool partial = false;
   if(want > 0 && want < held - 1e-8)
   {
      double vstep = SymbolInfoDouble(psym, SYMBOL_VOLUME_STEP);
      double vmin  = SymbolInfoDouble(psym, SYMBOL_VOLUME_MIN);
      if(vstep > 0) want = MathRound(want / vstep) * vstep;
      want = NormalizeDouble(want, 2);

      if(want < vmin)
      {
         Ack(id, false, StringFormat("%.2f lots is under the %.2f minimum on %s", want, vmin, psym));
         return;
      }
      // What would be left has to be tradable too, or the broker refuses
      // the whole thing and the position is untouched for a reason nobody
      // can see from the dashboard.
      if(held - want < vmin - 1e-8)
      {
         Ack(id, false, StringFormat("closing %.2f would leave %.2f, under the %.2f minimum — close it all instead",
                                     want, held - want, vmin));
         return;
      }
      partial = true;
   }

   for(int attempt = 0; attempt <= RetryCount && !ok; attempt++)
   {
      if(attempt > 0) Sleep(400);
      ok = partial ? g_trade.PositionClosePartial(ticket, want, MaxSlippagePoints)
                   : g_trade.PositionClose(ticket, MaxSlippagePoints);
      uint code = g_trade.ResultRetcode();
      if(!ok && code != TRADE_RETCODE_REQUOTE && code != TRADE_RETCODE_PRICE_CHANGED
             && code != TRADE_RETCODE_PRICE_OFF) break;
   }

   if(ok)
   {
      RememberExecution();
      Ack(id, true, partial ? StringFormat("closed %.2f of %.2f lots", want, held) : "closed", ticket);
   }
   else
      Ack(id, false, StringFormat("%u %s", g_trade.ResultRetcode(), g_trade.ResultRetcodeDescription()));
}

//+------------------------------------------------------------------+
//| Move stop loss / take profit on one position                     |
//+------------------------------------------------------------------+
void DoSetSlTp(string cmd, string id)
{
   ulong  ticket = (ulong)JsonNum(cmd, "ticket");
   double sl     = JsonNum(cmd, "sl");
   double tp     = JsonNum(cmd, "tp");
   if(ticket == 0) { Ack(id, false, "no ticket given"); return; }

   string why = "";
   if(!MayTouchPosition(ticket, why)) { Ack(id, false, why); return; }

   // The broker refuses stops closer to the market than its own minimum;
   // saying which is more use than "invalid stops".
   string sym  = PositionGetString(POSITION_SYMBOL);
   long   stopsLevel = SymbolInfoInteger(sym, SYMBOL_TRADE_STOPS_LEVEL);
   double point = SymbolInfoDouble(sym, SYMBOL_POINT);
   double cur   = PositionGetDouble(POSITION_PRICE_CURRENT);
   if(stopsLevel > 0 && point > 0)
   {
      double minDist = stopsLevel * point;
      if(sl > 0 && MathAbs(cur - sl) < minDist)
      {
         Ack(id, false, StringFormat("SL must be at least %d points from the price on %s", (int)stopsLevel, sym));
         return;
      }
      if(tp > 0 && MathAbs(cur - tp) < minDist)
      {
         Ack(id, false, StringFormat("TP must be at least %d points from the price on %s", (int)stopsLevel, sym));
         return;
      }
   }

   if(g_trade.PositionModify(ticket, sl, tp))
   {
      RememberExecution();
      Ack(id, true, "modified", ticket);
   }
   else
      Ack(id, false, StringFormat("%u %s", g_trade.ResultRetcode(), g_trade.ResultRetcodeDescription()));
}

//+------------------------------------------------------------------+
//| Close everything this EA is allowed to close                     |
//+------------------------------------------------------------------+
void DoCloseAll(string id)
{
   if(!AllowCloseAll) { Ack(id, false, "AllowCloseAll is off in the EA"); return; }

   int closed = 0, deleted = 0, skipped = 0, failed = 0;

   // Backwards: closing changes the list underneath us.
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      string why = "";
      if(!MayTouchPosition(ticket, why)) { skipped++; continue; }
      g_trade.SetTypeFillingBySymbol(PositionGetString(POSITION_SYMBOL));
      if(g_trade.PositionClose(ticket, MaxSlippagePoints)) closed++; else failed++;
   }

   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      ulong ticket = OrderGetTicket(i);
      if(ticket == 0) continue;
      long magic = OrderGetInteger(ORDER_MAGIC);
      if(MagicBlocked(magic)) { skipped++; continue; }
      if(magic != MagicNumber && !AllowManageForeign) { skipped++; continue; }
      if(g_trade.OrderDelete(ticket)) deleted++; else failed++;
   }

   if(closed > 0 || deleted > 0) RememberExecution();

   string summary = StringFormat("closed %d, deleted %d pending", closed, deleted);
   if(skipped > 0) summary += StringFormat(", left %d alone", skipped);
   if(failed > 0)
   {
      Ack(id, false, summary + StringFormat(", %d refused by the broker", failed));
      return;
   }
   Ack(id, true, summary);
}

//--- Defined below; declared here so the order of the file reads from
//--- the general to the particular rather than the other way round.
void SendAck();

//+------------------------------------------------------------------+
//| Work through the commands in the server's answer                 |
//+------------------------------------------------------------------+
void HandleCommands(string response)
{
   string arr = JsonArrayRaw(response, "commands");
   if(arr == "") return;

   string items[];
   int n = JsonObjects(arr, items);
   if(n == 0) return;

   g_ackJson = "";
   g_ackCount = 0;

   for(int i = 0; i < n; i++)
   {
      string cmd  = items[i];
      string id   = JsonStr(cmd, "id");
      string type = JsonStr(cmd, "type");
      if(id == "" || type == "") continue;

      if(AlreadyDone(id))
      {
         if(VerboseLog) Print("OnlyFunds: ignoring repeat of ", id);
         continue;
      }
      RememberDone(id);

      string why = "";
      if(!TradingPossible(why)) { Ack(id, false, why); continue; }

      int age = (int)JsonNum(cmd, "ageSec", 0);
      if(CommandMaxAgeSec > 0 && age > CommandMaxAgeSec)
      {
         Ack(id, false, StringFormat("%ds old, older than CommandMaxAgeSec (%ds)", age, CommandMaxAgeSec));
         continue;
      }

      if(type == "OPEN_TRADE")          DoOpenTrade(cmd, id);
      else if(type == "CLOSE_POSITION") DoClosePosition(cmd, id);
      else if(type == "SET_SLTP")       DoSetSlTp(cmd, id);
      else if(type == "CLOSE_ALL")      DoCloseAll(id);
      else                              Ack(id, false, "unknown command type: " + type);
   }

   if(g_ackCount > 0) SendAck();
}

//+------------------------------------------------------------------+
//| Tell the server what happened                                    |
//|                                                                  |
//| Without this the dashboard's last word is "queued", which says   |
//| nothing about whether a position exists.                          |
//+------------------------------------------------------------------+
void SendAck()
{
   string json = "{\"apiKey\":\"" + EscapeJson(ApiKey) + "\",\"results\":[" + g_ackJson + "]}";
   g_ackJson = "";
   g_ackCount = 0;

   string url     = ServerURL + "/api/mt5/ack";
   string headers = "Content-Type: application/json\r\n";
   char   post[], result[];
   string result_headers;
   StringToCharArray(json, post, 0, StringLen(json));

   int res = WebRequest("POST", url, headers, 5000, post, result, result_headers);
   if(res != 200)
      Print("OnlyFunds: could not report command results (HTTP ", res, ") — the dashboard will still show them as sent");
}
#endif // ONLYFUNDS_AI — end of the trading section

//+------------------------------------------------------------------+
void SendData()
{
   //--- Account Info
   long   acct_num    = AccountInfoInteger(ACCOUNT_LOGIN);
   string broker      = AccountInfoString(ACCOUNT_COMPANY);
   string server      = AccountInfoString(ACCOUNT_SERVER);
   string currency    = AccountInfoString(ACCOUNT_CURRENCY);
   long   leverage    = AccountInfoInteger(ACCOUNT_LEVERAGE);
   double balance     = AccountInfoDouble(ACCOUNT_BALANCE);
   double equity      = AccountInfoDouble(ACCOUNT_EQUITY);
   double margin      = AccountInfoDouble(ACCOUNT_MARGIN);
   double freeMargin  = AccountInfoDouble(ACCOUNT_FREEMARGIN);
   double credit      = AccountInfoDouble(ACCOUNT_CREDIT);
   // Floating P/L of open positions only — explicitly subtract credit so
   // promotional bonuses don't leak through.
   double profit      = equity - balance - credit;
   double marginLevel = 0;
   if(margin > 0)
      marginLevel = AccountInfoDouble(ACCOUNT_MARGIN_LEVEL);

   long   brokerOffsetSec = BrokerTimeOffsetSec();

   //--- Today's realized P/L (computed here, single trusted number)
   int    closedToday = 0;
   double todayPl     = ComputeTodayPl(closedToday);

   //--- Open Positions (numeric type: 0=BUY, 1=SELL)
   string orders_json = "";
   for(int i = 0; i < PositionsTotal(); i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;

      int      ptype      = (int)PositionGetInteger(POSITION_TYPE);
      string   sym        = PositionGetString(POSITION_SYMBOL);
      double   lots       = PositionGetDouble(POSITION_VOLUME);
      double   open_price = PositionGetDouble(POSITION_PRICE_OPEN);
      double   cur_price  = PositionGetDouble(POSITION_PRICE_CURRENT);
      double   sl         = PositionGetDouble(POSITION_SL);
      double   tp         = PositionGetDouble(POSITION_TP);
      double   swap       = PositionGetDouble(POSITION_SWAP);
      double   pos_profit = PositionGetDouble(POSITION_PROFIT);
      datetime open_time  = (datetime)PositionGetInteger(POSITION_TIME);

      if(orders_json != "") orders_json += ",";
      orders_json += StringFormat(
         "{\"ticket\":%d,\"symbol\":\"%s\",\"type\":%d,"
         "\"lots\":%.2f,\"openPrice\":%.5f,\"currentPrice\":%.5f,"
         "\"sl\":%.5f,\"tp\":%.5f,"
         "\"swap\":%.2f,\"commission\":0,\"profit\":%.2f,"
         "\"openTime\":\"%s\"}",
         (int)ticket, EscapeJson(sym), ptype,
         lots, open_price, cur_price,
         sl, tp, swap, pos_profit,
         TimeToString(open_time, TIME_DATE|TIME_SECONDS)
      );
   }

   //--- Pending Orders
   string pending_json = "";
   for(int i = 0; i < OrdersTotal(); i++)
   {
      ulong ticket = OrderGetTicket(i);
      if(ticket == 0) continue;

      int      otype  = (int)OrderGetInteger(ORDER_TYPE);
      string   sym    = OrderGetString(ORDER_SYMBOL);
      double   lots   = OrderGetDouble(ORDER_VOLUME_CURRENT);
      double   price  = OrderGetDouble(ORDER_PRICE_OPEN);
      double   sl     = OrderGetDouble(ORDER_SL);
      double   tp     = OrderGetDouble(ORDER_TP);
      datetime expiry = (datetime)OrderGetInteger(ORDER_TIME_EXPIRATION);

      if(pending_json != "") pending_json += ",";
      pending_json += StringFormat(
         "{\"ticket\":%d,\"symbol\":\"%s\",\"type\":%d,"
         "\"lots\":%.2f,\"openPrice\":%.5f,"
         "\"sl\":%.5f,\"tp\":%.5f,\"expiration\":\"%s\"}",
         (int)ticket, EscapeJson(sym), otype,
         lots, price, sl, tp,
         expiry > 0 ? TimeToString(expiry, TIME_DATE|TIME_SECONDS) : ""
      );
   }

   //--- Today's closed deals (for trade-history archival)
   string closed_deals_json = BuildClosedDealsJson();

   //--- The broker's symbol list, occasionally
   string symbols_json = BuildSymbolsJson();

   //--- And what a lot of each symbol in use is actually worth
   string specs_json = BuildSpecsJson();

   //--- Build JSON
   string json = StringFormat(
      "{"
      "\"apiKey\":\"%s\","
      "\"accountNumber\":\"%d\","
      "\"broker\":\"%s\","
      "\"server\":\"%s\","
      "\"currency\":\"%s\","
      "\"leverage\":%d,"
      "\"balance\":%.2f,"
      "\"equity\":%.2f,"
      "\"margin\":%.2f,"
      "\"freeMargin\":%.2f,"
      "\"marginLevel\":%.2f,"
      "\"profit\":%.2f,"
      "\"todayPnl\":%.2f,"
      "\"closedOrdersToday\":%d,"
      "\"brokerTimeOffset\":%d,"
#ifdef ONLYFUNDS_AI
      "\"eaVersion\":\"1.4-ai\","
      "\"canExecute\":%s,"
      "\"canPartialClose\":true,"
#else
      // Report Only. canExecute is formatted from EnableTrading, a const
      // false here, so the server is told plainly that nothing it sends
      // would be carried out — and the suffix tells it why, so it can say
      // "install the other build" rather than "switch trading on", which
      // would send someone hunting for a setting this build does not have.
      "\"eaVersion\":\"1.4-report\","
      "\"canExecute\":%s,"
      "\"canPartialClose\":false,"
#endif
      "\"orders\":[%s],"
      "\"pending\":[%s],"
      "\"closedDeals\":%s"
      "%s"
      "%s"
      "}",
      ApiKey,
      acct_num, EscapeJson(broker), EscapeJson(server), currency, (int)leverage,
      balance, equity, margin, freeMargin, marginLevel, profit,
      todayPl, closedToday,
      (int)brokerOffsetSec,
      EnableTrading ? "true" : "false",
      orders_json, pending_json, closed_deals_json,
      symbols_json, specs_json
   );

   //--- Send to /api/mt5/push
   string url     = ServerURL + "/api/mt5/push";
   string headers = "Content-Type: application/json\r\n";
   char   post[], result[];
   string result_headers;
   StringToCharArray(json, post, 0, StringLen(json));

   int res = WebRequest("POST", url, headers, 5000, post, result, result_headers);

   if(res == 200)
   {
      if(!g_initDone)
      {
         Print("✓ OnlyFunds: Connected! ", OF_BUILD, " | broker offset ", (int)brokerOffsetSec, "s | today P/L: ", DoubleToString(todayPl, 2), " (", closedToday, " deals)");
#ifdef ONLYFUNDS_AI
         Print("  Trading: ", EnableTrading ? "ON — this EA will carry out dashboard commands" : "off (EnableTrading is false)");
#else
         Print("  Trading: not in this build — this is Report Only");
#endif
         g_initDone = true;
      }

      // The answer carries any commands the dashboard has queued. With
      // EnableTrading off the server does not send them at all, so this
      // finds nothing — but it is read either way rather than trusting
      // the server to have got that right.
#ifdef ONLYFUNDS_AI
      if(EnableTrading)
         HandleCommands(CharArrayToString(result));
#endif
   }
   else if(res == 404)
      Print("✗ OnlyFunds: Account not found — เพิ่ม account ใน Dashboard ก่อน (API Key: ", ApiKey, ")");
   else if(res == 400)
      Print("✗ OnlyFunds: Bad request — ตรวจสอบ API Key");
   else if(res == -1)
   {
      Print("✗ OnlyFunds: ไม่สามารถเชื่อมต่อได้ — เพิ่ม URL ใน MT5 WebRequest whitelist:");
      Print("  Tools → Options → Expert Advisors → Allow WebRequest for listed URL");
      Print("  URL: ", ServerURL);
   }
   else
      Print("✗ OnlyFunds: HTTP error ", res);
}
//+------------------------------------------------------------------+

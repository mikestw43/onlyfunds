import { useState, useEffect } from 'react';
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { fetchEquityHistory } from '../../services/api';
import type { EquitySnapshot } from '../../types';

type Timeframe = '1D' | '1W' | '1M' | '3M';

interface Props {
  /** Left out for the whole portfolio rather than one account. */
  accountId?: string;
}

const formatDate = (ts: string, tf: Timeframe) => {
  const d = new Date(ts);
  if (tf === '1D') return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

export const EquityChart = ({ accountId }: Props) => {
  const [timeframe, setTimeframe] = useState<Timeframe>('1M');
  const [data, setData] = useState<EquitySnapshot[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchEquityHistory(accountId, timeframe)
      .then(setData)
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [accountId, timeframe]);

  const TF_BUTTONS: Timeframe[] = ['1D', '1W', '1M', '3M'];

  const tfBtn = (active: boolean): React.CSSProperties => ({
    fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', letterSpacing: '.5px',
    padding: '5px 9px', cursor: 'pointer',
    border: active ? '1px solid var(--cyan)' : '1px solid var(--border2)',
    background: active ? 'rgba(96,165,250,.1)' : 'none',
    color: active ? 'var(--cyan)' : 'var(--text-dim)',
  });

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', padding: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
        <span style={{ fontFamily: 'var(--ff-section)', fontSize: 'var(--fs-section)', color: 'var(--text)', letterSpacing: '.5px' }}>
          {accountId ? 'EQUITY HISTORY' : 'EQUITY HISTORY · ALL ACCOUNTS · USD'}
        </span>
        <div style={{ display: 'flex', gap: '4px' }}>
          {TF_BUTTONS.map(tf => (
            <button key={tf} onClick={() => setTimeframe(tf)} style={tfBtn(timeframe === tf)}>{tf}</button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ height: '260px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body)', color: 'var(--text-dim)' }}>
          Loading...
        </div>
      ) : data.length === 0 ? (
        <div style={{ height: '260px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--ff-body)', fontSize: 'var(--fs-body)', color: 'var(--text-dim)', textAlign: 'center' }}>
          No data yet. Snapshots are recorded every hour.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={data}>
            {/* Soft fill under the equity line — the spec asks for an area
                read rather than a saturated line on a dark field. */}
            <defs>
              <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.28} />
                <stop offset="100%" stopColor="#60a5fa" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(42,45,52,.5)" />
            <XAxis
              dataKey="timestamp"
              tickFormatter={(v) => formatDate(v, timeframe)}
              tick={{ fontSize: 10, fill: '#6b7280', fontFamily: 'var(--ff-body)' }}
              stroke="#3b3e46"
            />
            <YAxis
              tick={{ fontSize: 10, fill: '#6b7280', fontFamily: 'var(--ff-body)' }}
              stroke="#3b3e46"
              domain={['auto', 'auto']}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#2b2d33',
                border: '1px solid #3b3e46',
                borderRadius: 6,
                fontFamily: 'var(--ff-body)',
                fontSize: 11,
              }}
              labelFormatter={(v) => new Date(v as string).toLocaleString()}
              formatter={((value: number | undefined, name: string | undefined) => [
                value != null ? `$${value.toFixed(2)}` : '—',
                name === 'equity' ? 'Equity' : 'Balance',
              ]) as never}
            />
            <Legend wrapperStyle={{ fontSize: 11, fontFamily: 'var(--ff-body)' }} />
            <Area
              type="monotone"
              dataKey="equity"
              stroke="#60a5fa"
              strokeWidth={2}
              fill="url(#equityFill)"
              dot={false}
              name="Equity"
            />
            <Line type="monotone" dataKey="balance" stroke="#6b7280" strokeWidth={1.5} dot={false} strokeDasharray="4 4" name="Balance" />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
};

import React, { useState, useEffect } from 'react';
import AdminService from '../../utils/AdminService';
import { Activity, Users, Database, Server, CheckCircle2, AlertCircle } from 'lucide-react';

/**
 * AdminDashboard displays high-level system telemetry and metrics.
 */
const AdminDashboard = () => {
  const [metrics, setMetrics] = useState({
    totalUsers: 0,
    totalMessages: 0,
    dbStatus: 'LOADING',
    rabbitMqStatus: 'LOADING',
    systemLoad: 'LOADING'
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const fetchMetrics = async () => {
    try {
      const data = await AdminService.getMetrics();
      setMetrics(data);
    } catch (error) {
      console.error('Failed to fetch metrics', error);
    } finally {
      setLoading(false);
    }
  };

  const MetricCard = ({ title, value, icon: Icon, color, subtext }) => (
    <div className="bg-slate-800 border border-slate-700 p-6 rounded-2xl shadow-xl hover:border-slate-600 transition-all">
      <div className="flex justify-between items-start mb-4">
        <div className={`p-3 rounded-xl ${color}`}>
          <Icon size={24} className="text-white" />
        </div>
        <div className="flex items-center gap-1 text-emerald-400 text-xs font-medium">
          <Activity size={12} />
          <span>LIVE</span>
        </div>
      </div>
      <p className="text-slate-400 text-sm font-medium uppercase tracking-wider">{title}</p>
      <h3 className="text-3xl font-bold mt-2 text-slate-100">{value}</h3>
      <p className="text-slate-500 text-xs mt-2">{subtext}</p>
    </div>
  );

  const StatusItem = ({ label, status }) => (
    <div className="flex items-center justify-between p-4 bg-slate-800/50 rounded-xl border border-slate-700/50">
      <span className="text-slate-300 font-medium">{label}</span>
      <div className="flex items-center gap-2">
        <span className={`text-xs font-bold px-2 py-1 rounded ${
          status === 'HEALTHY' || status === 'ACTIVE' || status === 'NORMAL' 
            ? 'bg-emerald-500/10 text-emerald-400' 
            : 'bg-rose-500/10 text-rose-400'
        }`}>
          {status}
        </span>
        {status === 'HEALTHY' || status === 'ACTIVE' || status === 'NORMAL' 
          ? <CheckCircle2 size={16} className="text-emerald-500" />
          : <AlertCircle size={16} className="text-rose-500" />
        }
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Activity className="animate-spin text-emerald-400" size={48} />
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard 
          title="Total Identities" 
          value={metrics.totalUsers} 
          icon={Users} 
          color="bg-blue-500" 
          subtext="Active cryptographic users"
        />
        <MetricCard 
          title="E2EE Packets" 
          value={metrics.totalMessages} 
          icon={Database} 
          color="bg-emerald-500" 
          subtext="Total routed secure messages"
        />
        <MetricCard 
          title="Streaming Node" 
          value="Online" 
          icon={Server} 
          color="bg-purple-500" 
          subtext="2GB Resumable file server"
        />
        <MetricCard 
          title="Handshake Node" 
          value="Healthy" 
          icon={Activity} 
          color="bg-orange-500" 
          subtext="RSA/AES key exchange relay"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 shadow-xl">
          <h3 className="text-lg font-bold text-slate-100 mb-6 flex items-center gap-2">
            <Activity size={20} className="text-emerald-400" />
            Core Infrastructure Health
          </h3>
          <div className="space-y-4">
            <StatusItem label="PostgreSQL Database Clusters" status={metrics.dbStatus} />
            <StatusItem label="RabbitMQ STOMP Broker" status={metrics.rabbitMqStatus} />
            <StatusItem label="API Node Service Load" status={metrics.systemLoad} />
            <StatusItem label="Firebase Cloud Messaging" status="ACTIVE" />
          </div>
        </div>

        <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 shadow-xl flex flex-col justify-center items-center text-center">
          <div className="w-20 h-20 bg-emerald-500/10 rounded-full flex items-center justify-center mb-4 border border-emerald-500/20">
            <Shield size={40} className="text-emerald-400" />
          </div>
          <h3 className="text-xl font-bold text-slate-100">Zero-Knowledge Secure</h3>
          <p className="text-slate-400 mt-2 max-w-sm">
            All administrative oversight is limited to organizational metadata. 
            Cryptographic keys and message content remain strictly client-side.
          </p>
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;

import { useNavigate } from 'react-router-dom';
import { Clock, KeyRound, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { AutoLockSetting } from '../components/AutoLockSetting';
import { ChangeMasterPassword } from '../components/ChangeMasterPassword';
import { RecoveryKeySettings } from '../components/RecoveryKeySettings';
import { VaultPage } from '../components/VaultPage';

/** 保险箱设置:恢复密钥、自动锁定、修改主密码。不提供"选择 KDF"之类的选项,参数由产品定 */
export default function VaultSettings() {
  const navigate = useNavigate();
  return (
    <VaultPage title="保险箱设置" onBack={() => navigate('/vault')}>
      <div className="space-y-8">
        <Section icon={<ShieldCheck className="w-5 h-5 text-mapblue" aria-hidden="true" />} title="恢复密钥">
          <RecoveryKeySettings />
        </Section>
        <Section icon={<Clock className="w-5 h-5 text-mapblue" aria-hidden="true" />} title="自动锁定">
          <AutoLockSetting />
        </Section>
        <Section icon={<KeyRound className="w-5 h-5 text-mapblue" aria-hidden="true" />} title="修改主密码">
          <ChangeMasterPassword />
        </Section>
      </div>
    </VaultPage>
  );
}

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <h3 className="text-lg font-semibold text-ink mb-4 flex items-center gap-2">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

"use client";
import type { DeviceStatus } from "@/lib/device";
import type { MemberState } from "@/lib/useMember";
import styles from "./DeviceNotice.module.css";

/** Why real play is off on this device, in one sentence. */
export function deviceNote(device: DeviceStatus): string {
  if (device === "blocked") return "أوقف المالك اللعب من هذا الجهاز.";
  return "هذا جهاز جديد على حسابك، وينتظر موافقة المالك قبل اللعب بالرصيد الحقيقي.";
}

/** A banner for members on a device the owner has not approved (spec appendix ط). */
export function DeviceNotice({ member }: { member: MemberState }) {
  if (member.status !== "member") return null;
  if (member.profile.status !== "active") {
    return (
      <p className={styles.notice} role="status">
        أوقف المالك اللعب بالرصيد الحقيقي في حسابك مؤقتاً. يمكنك تجربة الألعاب بالنقاط التجريبية.
      </p>
    );
  }
  const d = member.device;
  if (d === "approved" || d === "unknown") return null;
  return (
    <p className={styles.notice} role="status">
      {deviceNote(d)} يمكنك تجربة الألعاب بالنقاط التجريبية حتى ذلك الحين.
    </p>
  );
}

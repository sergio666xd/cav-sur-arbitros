import { Badge } from "./ui";

export type UserRow = {
  id: number;
  first_name: string;
  last_name: string;
  document: string;
  whatsapp: string | null;
  is_referee: boolean;
  is_admin: boolean;
  can_create_tournaments: boolean;
  is_chief: boolean;
  active: boolean;
  is_system?: boolean; // Solo llega cuando quien mira tiene poderes de Jefe.
  age?: number;
  birth_date?: string;
  refereed: number;
  scored: number;
  other: number;
  assignments: number;
  points: number | null;
};

export function RoleBadges({ u }: { u: Pick<UserRow, "is_chief" | "is_admin" | "is_referee" | "can_create_tournaments" | "active" | "is_system"> }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {u.is_chief && <Badge color="brand">Jefe</Badge>}
      {u.is_system && <Badge color="violet">System</Badge>}
      {!u.is_chief && u.is_admin && <Badge color="blue">Admin{u.can_create_tournaments ? " + torneos" : ""}</Badge>}
      {!u.is_chief && u.is_referee && <Badge color="stone">Árbitro</Badge>}
      {!u.active && <Badge color="red">Suspendido</Badge>}
    </span>
  );
}

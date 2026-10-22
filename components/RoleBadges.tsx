import { Badge } from "./ui";

export type UserRow = {
  id: number;
  first_name: string;
  last_name: string;
  document: string;
  is_referee: boolean;
  is_admin: boolean;
  can_create_tournaments: boolean;
  is_chief: boolean;
  active: boolean;
  age?: number;
  birth_date?: string;
  refereed: number;
  scored: number;
  other: number;
  assignments: number;
  points: number | null;
};

export function RoleBadges({ u }: { u: Pick<UserRow, "is_chief" | "is_admin" | "is_referee" | "can_create_tournaments" | "active"> }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {u.is_chief && <Badge color="brand">Jefe</Badge>}
      {!u.is_chief && u.is_admin && <Badge color="blue">Admin{u.can_create_tournaments ? " + torneos" : ""}</Badge>}
      {!u.is_chief && u.is_referee && <Badge color="stone">Árbitro</Badge>}
      {!u.active && <Badge color="red">Inactivo</Badge>}
    </span>
  );
}

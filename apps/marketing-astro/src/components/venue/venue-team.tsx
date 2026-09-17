import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { VenueConfig } from '@borradh-workspace/contracts';

type TeamMember = VenueConfig['team'][number];

interface VenueTeamProps {
  team: TeamMember[];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

/** The Team block: circular avatars with name, title and optional bio. */
export function VenueTeam({ team }: VenueTeamProps) {
  if (team.length === 0) return null;

  return (
    <section id="team" className="space-y-4">
      <h2 className="font-bold text-2xl">Team</h2>
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4">
        {team.map((member) => (
          <div key={member.id} className="space-y-2 text-center">
            <Avatar className="mx-auto size-24">
              {member.photo && (
                <AvatarImage src={member.photo} alt={member.name} />
              )}
              <AvatarFallback className="text-xl">
                {initials(member.name)}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="font-medium">{member.name}</p>
              {member.title && (
                <p className="text-muted-foreground text-sm">{member.title}</p>
              )}
            </div>
            {member.bio && (
              <p className="line-clamp-3 text-muted-foreground text-xs">
                {member.bio}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

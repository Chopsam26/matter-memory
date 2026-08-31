'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useIdentity } from '@/components/identity';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/query', label: 'Query' },
  { href: '/upload', label: 'Upload' },
];

export function SiteHeader() {
  const pathname = usePathname();
  const { users, userId, setUserId, user, loading } = useIdentity();

  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 max-w-4xl items-center gap-6 px-6">
        <Link href="/query" className="font-semibold tracking-tight">
          Matter Memory
        </Link>

        <nav className="flex items-center gap-4 text-sm">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'transition-colors hover:text-foreground',
                pathname === item.href ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {user && (
            <Badge variant={user.role === 'attorney' ? 'default' : 'secondary'}>
              {user.role}
            </Badge>
          )}
          <Select
            value={userId === null ? null : String(userId)}
            onValueChange={(v) => setUserId(Number(v))}
            disabled={loading || users.length === 0}
          >
            <SelectTrigger size="sm" className="w-44" aria-label="Signed in as">
              <SelectValue>
                {(value: string | null) =>
                  users.find((u) => String(u.id) === value)?.name ??
                  (loading ? 'Loading…' : 'No users')
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {users.map((u) => (
                <SelectItem key={u.id} value={String(u.id)}>
                  {u.name} · {u.role}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </header>
  );
}

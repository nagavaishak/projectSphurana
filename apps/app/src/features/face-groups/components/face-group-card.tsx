import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type {
  FaceGroupAssetRole,
  FaceGroupWithAssets,
} from '@borradh-workspace/api-client/types';
import { faceGroupAssetRoleLabels } from '@borradh-workspace/api-client/types';
import { CheckIcon, PencilIcon, UserIcon } from 'lucide-react';
import { useState } from 'react';
import { useUpdateFaceGroup } from '../api/update-face-group';
import { useUpdateFaceGroupAssetRole } from '../api/update-face-group-asset-role';
import { updateFaceGroupForm } from './update-face-group-schema';

interface FaceGroupCardProps {
  group: FaceGroupWithAssets;
}

/** Labels come from the form declaration — see `update-face-group-schema`. */
const L = updateFaceGroupForm.labels;

export function FaceGroupCard({ group }: FaceGroupCardProps) {
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(group.clientName ?? '');
  const { updateFaceGroup, isUpdating } = useUpdateFaceGroup({
    onSuccess: () => setIsEditingName(false),
  });
  const { updateRole } = useUpdateFaceGroupAssetRole();

  const handleSaveName = () => {
    if (nameInput.trim()) {
      updateFaceGroup({
        groupId: group.id,
        clientName: nameInput.trim(),
      });
    }
  };

  const handleRoleChange = (assetId: string, role: FaceGroupAssetRole) => {
    updateRole({ groupId: group.id, assetId, role });
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center gap-3 pb-3">
        <Avatar className="h-12 w-12">
          <AvatarFallback>
            <UserIcon className="h-6 w-6" />
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          {isEditingName ? (
            <div className="flex items-center gap-2">
              <Input
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="Client name"
                aria-label={L.clientName}
                className="h-8"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveName();
                  if (e.key === 'Escape') setIsEditingName(false);
                }}
                autoFocus
              />
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 shrink-0"
                onClick={handleSaveName}
                disabled={isUpdating}
              >
                <CheckIcon className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="font-medium truncate">
                {group.clientName ?? 'Unknown Person'}
              </span>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 shrink-0"
                onClick={() => setIsEditingName(true)}
              >
                <PencilIcon className="h-3 w-3" />
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-3">
          {group.assets.map((fga) => (
            <div key={fga.id} className="flex flex-col items-center gap-1.5">
              <div className="w-20 h-20 rounded-md overflow-hidden bg-muted">
                {fga.asset.type === 'image' ? (
                  <img
                    src={fga.asset.blobUrl}
                    alt={fga.asset.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">
                    Video
                  </div>
                )}
              </div>
              <Select
                value={fga.role}
                onValueChange={(value) =>
                  handleRoleChange(fga.assetId, value as FaceGroupAssetRole)
                }
              >
                <SelectTrigger className="h-7 w-24 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(
                    Object.entries(faceGroupAssetRoleLabels) as [
                      FaceGroupAssetRole,
                      string,
                    ][]
                  ).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

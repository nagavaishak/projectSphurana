import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class SynthesizeVideoVoiceDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsOptional()
  @IsString()
  provider?: string;

  @IsOptional()
  @IsString()
  url?: string;
}

export class SynthesizeVideoRenderOptionsDto {
  @IsOptional()
  @IsNumber()
  width?: number;

  @IsOptional()
  @IsNumber()
  height?: number;

  @IsOptional()
  @IsNumber()
  fps?: number;

  @IsOptional()
  @IsString()
  format?: string;
}

export class SynthesizeVideoDto {
  @IsOptional()
  @IsIn(['v2'])
  version?: 'v2';

  @IsOptional()
  @IsIn(['v2'])
  engineVersion?: 'v2';

  @IsOptional()
  @IsString()
  templateId?: string;

  @IsOptional()
  @IsString()
  template?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  topic?: string;

  @IsOptional()
  @IsString()
  audience?: string;

  @IsOptional()
  @IsString()
  tone?: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsString()
  aspectRatio?: string;

  @IsOptional()
  @IsNumber()
  durationSeconds?: number;

  @IsOptional()
  @IsString()
  prompt?: string;

  @IsOptional()
  @IsString()
  script?: string;

  @IsOptional()
  @IsString()
  musicTrackId?: string;

  @IsOptional()
  @ValidateNested()
  voice?: SynthesizeVideoVoiceDto;

  @IsOptional()
  @IsArray()
  scenes?: unknown[];

  @IsOptional()
  transcript?: Record<string, unknown>;

  @IsOptional()
  renderDoc?: Record<string, unknown>;

  @IsOptional()
  bRoll?: unknown;

  @IsOptional()
  output?: Record<string, unknown>;

  @IsOptional()
  @ValidateNested()
  renderOptions?: SynthesizeVideoRenderOptionsDto;

  @IsOptional()
  @IsBoolean()
  enqueue?: boolean;
}

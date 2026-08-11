import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { AuthGuard, PassportStrategy } from "@nestjs/passport";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { ExtractJwt, Strategy } from "passport-jwt";
import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";
import { createHash, randomUUID } from "crypto";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "./prisma.service";

export class RegisterDto {
  @IsEmail() @MaxLength(254) email!: string;
  @IsString()
  @MinLength(3)
  @MaxLength(32)
  @Matches(/^[\p{L}\p{N}_.-]+$/u)
  username!: string;
  @IsString() @MinLength(2) @MaxLength(80) displayName!: string;
  @IsString()
  @MinLength(10)
  @MaxLength(128)
  @Matches(/^(?=.*[\p{L}])(?=.*\d).+$/u, {
    message: "Пароль должен содержать буквы и цифры",
  })
  password!: string;
}
export class LoginDto {
  @IsString() @MinLength(1) @MaxLength(254) login!: string;
  @IsString() @MinLength(1) @MaxLength(128) password!: string;
}
export class RefreshDto {
  @IsString() @MinLength(20) refreshToken!: string;
}

type TokenPayload = {
  sub: string;
  username: string;
  type: "access" | "refresh";
  jti?: string;
};
const DUMMY_PASSWORD_HASH = bcrypt.hashSync("pulse-dummy-password-123", 12);

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.getOrThrow<string>("JWT_SECRET"),
      ignoreExpiration: false,
    });
  }
  validate(payload: TokenPayload) {
    if (payload.type !== "access") throw new UnauthorizedException();
    return { id: payload.sub, username: payload.username };
  }
}
export class JwtAuthGuard extends AuthGuard("jwt") {}

@Injectable()
export class AuthRateLimitGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const ip = req.ips?.[0] ?? req.ip ?? req.socket?.remoteAddress ?? "unknown";
    const identity = String(req.body?.email ?? req.body?.login ?? "unknown")
      .trim()
      .toLowerCase()
      .slice(0, 254);
    return `${ip}:${identity}`;
  }
}

@Injectable()
export class AuthService {
  private readonly accessTtl: number;
  private readonly refreshTtl: number;
  private readonly refreshSecret: string;
  constructor(
    private db: PrismaService,
    private jwt: JwtService,
    config: ConfigService,
  ) {
    this.accessTtl = Number(config.get("ACCESS_TOKEN_TTL_SECONDS", 900));
    this.refreshTtl = Number(
      config.get("REFRESH_TOKEN_TTL_SECONDS", 2_592_000),
    );
    this.refreshSecret = config.getOrThrow<string>("REFRESH_JWT_SECRET");
  }
  private safe(user: any) {
    const { passwordHash: _passwordHash, ...result } = user;
    return result;
  }
  private hash(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }
  private tokenPairData(user: any) {
    const id = randomUUID();
    const accessToken = this.jwt.sign(
      {
        sub: user.id,
        username: user.username,
        type: "access",
      } satisfies TokenPayload,
      { expiresIn: this.accessTtl },
    );
    const refreshToken = this.jwt.sign(
      {
        sub: user.id,
        username: user.username,
        type: "refresh",
        jti: id,
      } satisfies TokenPayload,
      { secret: this.refreshSecret, expiresIn: this.refreshTtl },
    );
    const record = {
      id,
      userId: user.id,
      tokenHash: this.hash(refreshToken),
      expiresAt: new Date(Date.now() + this.refreshTtl * 1000),
    };
    return { accessToken, refreshToken, record };
  }
  private async result(user: any) {
    const pair = this.tokenPairData(user);
    await this.db.refreshToken.create({ data: pair.record });
    return {
      user: this.safe(user),
      accessToken: pair.accessToken,
      refreshToken: pair.refreshToken,
    };
  }
  async register(dto: RegisterDto) {
    let user;
    try {
      user = await this.db.user.create({
        data: {
          email: dto.email.trim().toLowerCase(),
          username: dto.username.trim(),
          displayName: dto.displayName.trim(),
          passwordHash: await bcrypt.hash(dto.password, 12),
        },
      });
    } catch (error) {
      const prismaError = error as {
        code?: string;
        meta?: { target?: unknown };
      };
      if (prismaError?.code !== "P2002") throw error;
      const target = JSON.stringify(
        prismaError.meta?.target ?? "",
      ).toLowerCase();
      if (target.includes("email"))
        throw new ConflictException("Эта почта уже используется");
      if (target.includes("username"))
        throw new ConflictException("Такой username уже занят");
      throw new ConflictException(
        "Пользователь с такими данными уже существует",
      );
    }
    return this.result(user);
  }
  async login(dto: LoginDto) {
    const login = dto.login.trim();
    const user = await this.db.user.findFirst({
      where: { OR: [{ email: login.toLowerCase() }, { username: login }] },
    });
    const passwordMatches = await bcrypt.compare(
      dto.password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );
    if (!user || !passwordMatches)
      throw new UnauthorizedException("Неверные учётные данные");
    return this.result(user);
  }
  async refresh(raw: string) {
    let payload: TokenPayload;
    try {
      payload = this.jwt.verify<TokenPayload>(raw, {
        secret: this.refreshSecret,
      });
    } catch {
      throw new UnauthorizedException("Refresh-токен недействителен");
    }
    if (payload.type !== "refresh" || !payload.jti)
      throw new UnauthorizedException("Refresh-токен недействителен");
    const stored = await this.db.refreshToken.findUnique({
      where: { tokenHash: this.hash(raw) },
      include: { user: true },
    });
    if (
      !stored ||
      stored.id !== payload.jti ||
      stored.revokedAt ||
      stored.expiresAt <= new Date()
    )
      throw new UnauthorizedException("Refresh-токен отозван или истёк");
    const pair = this.tokenPairData(stored.user);
    await this.db.$transaction(async (transaction) => {
      const revoked = await transaction.refreshToken.updateMany({
        where: { id: stored.id, revokedAt: null },
        data: { revokedAt: new Date(), replacedById: pair.record.id },
      });
      if (revoked.count !== 1)
        throw new UnauthorizedException("Refresh-токен уже использован");
      await transaction.refreshToken.create({ data: pair.record });
    });
    return {
      user: this.safe(stored.user),
      accessToken: pair.accessToken,
      refreshToken: pair.refreshToken,
    };
  }
  async logout(raw: string) {
    await this.db.refreshToken.updateMany({
      where: { tokenHash: this.hash(raw), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  }
}

@Controller("auth")
export class AuthController {
  constructor(
    private auth: AuthService,
    private db: PrismaService,
  ) {}
  @Post("register")
  @UseGuards(AuthRateLimitGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }
  @Post("login")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthRateLimitGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthRateLimitGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }
  @Post("logout")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthRateLimitGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  logout(@Body() dto: RefreshDto) {
    return this.auth.logout(dto.refreshToken);
  }
  @Get("me") @UseGuards(JwtAuthGuard) me(@Req() req: any) {
    return this.db.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        bio: true,
      },
    });
  }
}

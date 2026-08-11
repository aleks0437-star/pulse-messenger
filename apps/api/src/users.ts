import { Controller, Get, Injectable, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { JwtAuthGuard } from './auth';
import { PrismaService } from './prisma.service';

class SearchUsersDto { @IsString() @MinLength(2) @MaxLength(80) q!:string }

@Injectable()
export class UsersService {
  constructor(private db:PrismaService){}
  search(q:string,userId:string){
    const value=q.trim();
    return this.db.user.findMany({
      where:{id:{not:userId},OR:[{username:{contains:value,mode:'insensitive'}},{email:{contains:value,mode:'insensitive'}},{displayName:{contains:value,mode:'insensitive'}}]},
      select:{id:true,username:true,displayName:true,avatarUrl:true},take:10,orderBy:{displayName:'asc'},
    });
  }
}

@Controller('users') @UseGuards(JwtAuthGuard,ThrottlerGuard)
export class UsersController {
  constructor(private users:UsersService){}
  @Get('search') @Throttle({default:{limit:30,ttl:60_000}})
  search(@Query()query:SearchUsersDto,@Req()req:any){return this.users.search(query.q,req.user.id)}
}

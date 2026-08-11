import { UsersService } from '../src/users';

describe('UsersService search',()=>{
  it('excludes the caller, limits results and exposes no email or password',async()=>{
    const db:any={user:{findMany:jest.fn().mockResolvedValue([{id:'u2',username:'friend',displayName:'Friend'}])}};
    const service=new UsersService(db);const result=await service.search('fri','u1');
    expect(db.user.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({id:{not:'u1'}}),select:{id:true,username:true,displayName:true,avatarUrl:true},take:10}));
    expect(result[0]).not.toHaveProperty('email');expect(result[0]).not.toHaveProperty('passwordHash');
  });
});

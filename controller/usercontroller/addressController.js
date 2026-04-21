exports.addAddress = async(req,res)=>{
    const user = await user.findfById(req.session.user._id);

    user.address.push(req.body);
    await user.save();

    res.redirect("/profile")
}